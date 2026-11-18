"""ShellStream server: one interactive session, shells pushed over a WebSocket.

* Tornado is used because it ships with every Jupyter installation (no extra dependency on Kaggle).
* Built-in network emulation (one-way delays, jitter, bottleneck bandwidth) for experiments.
* Application-level flow control: at most `max_inflight` un-acknowledged shells -> no TCP bufferbloat.
* Event-driven: a shell is only rendered when the client's pose/lighting changed (or every
  `idle_interval` s for animated content), so a player standing still costs ~0 bandwidth.
"""
from __future__ import annotations

import asyncio
import collections
import hmac
import json
import math
import os
import random
import threading
import time

from concurrent.futures import ThreadPoolExecutor

import tornado.ioloop
import tornado.web
import tornado.websocket

HERE = os.path.dirname(os.path.abspath(__file__))
CLIENT_DIR = os.path.join(HERE, "client")


class NetEmu:
    def __init__(self, up_ms=0.0, down_ms=0.0, jitter_ms=0.0, down_mbps=None):
        self.up_ms, self.down_ms, self.jitter_ms, self.down_mbps = up_ms, down_ms, jitter_ms, down_mbps
        self.stall_until = 0.0
        self._last_down = 0.0
        self._last_up = 0.0

    def up_at(self, now):
        t = now + (self.up_ms + random.uniform(0, self.jitter_ms)) / 1000.0
        t = max(t, self._last_up)
        self._last_up = t
        return t

    def down_at(self, now, nbytes):
        t = now + (self.down_ms + random.uniform(0, self.jitter_ms)) / 1000.0
        t = max(t, self._last_down, self.stall_until)
        if self.down_mbps:
            t += nbytes * 8 / (self.down_mbps * 1e6)
        self._last_down = t
        return t


class Session:
    def __init__(self, server, handler):
        self.server = server
        self.h = handler
        self.state = None
        self.ev = threading.Event()
        self.alive = True
        self.frame_id = 0
        self.acked = -1
        self.sent_t = {}
        self.last_sig = None
        self.last_send = 0.0
        self.log = collections.deque(maxlen=4000)
        self.refine = 0
        self.out = ThreadPoolExecutor(1)
        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()

    # ---------------------------------------------------------- input path (IOLoop thread)
    def on_message(self, msg: dict):
        typ = msg.get("type")
        if typ == "input":
            self.state = msg
            self.ev.set()
        elif typ == "ack":
            self.acked = max(self.acked, int(msg.get("id", -1)))
            self.ev.set()
        elif typ == "ping":
            self.send_text({"type": "pong", "t": msg.get("t"), "ts": time.perf_counter() * 1000})
        elif typ == "netemu":
            ne = self.server.net
            for k in ("up_ms", "down_ms", "jitter_ms", "down_mbps"):
                if k in msg:
                    setattr(ne, k, msg[k])
            if msg.get("stall_ms"):
                ne.stall_until = time.perf_counter() + msg["stall_ms"] / 1000.0
        elif typ == "cfg" and hasattr(self.server.builder, "cfg"):
            for k, v in msg.items():
                if k in self.server.builder.cfg:
                    self.server.builder.cfg[k] = v

    # ---------------------------------------------------------- output path
    def send_text(self, obj):
        self.server.send(self.h, json.dumps(obj), binary=False)

    def _signature(self, st):
        p = st.get("pos", [0, 0, 0])
        return (st.get("mode"), round(p[0], 3), round(p[1], 3), round(p[2], 3), round(st.get("yaw", 0), 3),
                round(st.get("pitch", 0), 3), st.get("fov"), st.get("vw"), json.dumps(st.get("lights", []))[:2000])

    def _loop(self):
        srv = self.server
        while self.alive:
            self.ev.wait(timeout=srv.idle_interval)
            self.ev.clear()
            if not self.alive or self.state is None:
                continue
            now = time.perf_counter()
            # rate limit
            wait = self.last_send + 1.0 / srv.max_rate - now
            if wait > 0:
                time.sleep(wait)
            # flow control (bounded number of shells in flight)
            t_wait = time.perf_counter()
            while self.alive and self.frame_id - 1 - self.acked >= srv.max_inflight:
                if time.perf_counter() - t_wait > 1.0:      # lost ack -> resync
                    self.acked = self.frame_id - 1
                    break
                self.ev.wait(timeout=0.005); self.ev.clear()
            st = dict(self.state)
            sig = self._signature(st)
            since = time.perf_counter() - self.last_send
            if sig == self.last_sig:
                # nothing moved: spend the idle GPUs on progressive refinement of the same shell (more samples
                # per pixel), then go quiet; animated content is refreshed every idle_interval
                if self.refine < srv.max_refine and since >= srv.refine_delay:
                    self.refine += 1
                elif srv.animate and since >= srv.idle_interval:
                    pass
                else:
                    continue                   # nothing changed: no render, no bytes
            else:
                self.refine = 0
            st["interval"] = 1000.0 / srv.max_rate
            st["time"] = time.time() % 3600 if srv.animate else 0.0
            fid = self.frame_id
            try:
                ctx = srv.builder.stage1(st, fid, self.refine) if hasattr(srv.builder, "stage1") else ("done", srv.builder.build(st, fid))
            except Exception as e:  # keep the session alive, report
                import traceback; traceback.print_exc()
                self.send_text({"type": "error", "msg": repr(e)})
                time.sleep(0.2)
                continue
            self.last_sig = sig
            self.last_send = time.perf_counter()
            self.sent_t[fid] = self.last_send
            self.frame_id += 1
            # host stage (deflate + packing) overlaps the next GPU stage; one worker keeps sends in order
            self.out.submit(self._finish, ctx, fid, st.get("seq"))

    def _finish(self, ctx, fid, seq):
        srv = self.server
        try:
            msg, stats, plan = srv.builder.finish(ctx) if hasattr(srv.builder, "finish") else ctx[1]
        except Exception as e:
            import traceback; traceback.print_exc()
            self.send_text({"type": "error", "msg": repr(e)})
            return
        stats["t_build_end"] = time.perf_counter() * 1000
        stats["id"] = fid
        stats["in_seq"] = seq
        self.log.append(stats)
        if self.alive:
            srv.send(self.h, msg, binary=True)

    def close(self):
        self.alive = False
        self.ev.set()


class HostSession(Session):
    """Game-host mode: input events are injected into the game the moment they arrive (after the emulated
    uplink delay); frames are captured at a fixed rate, skipped when identical, and never dropped after
    encoding (video frames reference each other), so flow control acts *before* capture.  Game audio, if
    enabled, travels beside the frames as Opus packets, outside the frame flow control."""

    def __init__(self, server, handler):
        self.audio = None
        super().__init__(server, handler)
        if server.audio:
            try:
                import host_audio

                def on_packet(data, pts, h=handler):
                    hb = json.dumps({"type": "audio", "ts": pts, "dlen": len(data)}, separators=(",", ":")).encode()
                    server.send(h, len(hb).to_bytes(4, "little") + hb + data, binary=True)
                self.audio = host_audio.AudioCapture(on_packet)
            except Exception as e:                  # no audio device or library: video still works
                self.send_text({"type": "error", "msg": f"audio unavailable: {e!r}"})

    def close(self):
        super().close()
        if self.audio:
            self.audio.stop()

    def on_message(self, msg: dict):
        typ = msg.get("type")
        if typ == "ev":
            self.server.builder.inject(msg.get("ev", []))
            self.state = msg
        elif typ == "keyframe":
            self.server.builder.request_keyframe()
        elif typ == "codec":
            self.server.builder.set_codec(msg.get("codec", "jpeg"))
        else:
            super().on_message(msg)

    def _loop(self):
        srv, host = self.server, self.server.builder
        host.request_keyframe()
        next_t = time.perf_counter()
        while self.alive:
            next_t += 1.0 / srv.max_rate
            dt = next_t - time.perf_counter()
            if dt > 0:
                time.sleep(dt)
            else:
                next_t = time.perf_counter()
            # in-flight window sized to the round trip (bandwidth-delay product), not a fixed 2 frames:
            # otherwise a long RTT throttles the stream to 2 frames per RTT
            rtt = float((self.state or {}).get("rtt", 50.0))
            window = max(srv.max_inflight, int(math.ceil(rtt / (1000.0 / srv.max_rate))) + 2)
            t_wait = time.perf_counter()
            while self.alive and self.frame_id - 1 - self.acked >= window:
                if time.perf_counter() - t_wait > 1.0:
                    self.acked = self.frame_id - 1
                    host.request_keyframe()
                    break
                self.ev.wait(timeout=0.002); self.ev.clear()
            try:
                msg, stats = host.produce(self.frame_id)
            except Exception as e:
                import traceback; traceback.print_exc()
                self.send_text({"type": "error", "msg": repr(e)})
                time.sleep(0.2)
                continue
            if msg is None:
                continue
            stats["id"] = self.frame_id
            stats["t"] = time.perf_counter() * 1000
            self.log.append(stats)
            self.frame_id += 1
            srv.send(self.h, msg, binary=True)


def _token_ok(handler):
    """The game host gives whoever connects the machine's mouse and keyboard, so a server reachable from other
    machines requires a token: once in the URL (?token=...), then as an HttpOnly, SameSite=Strict cookie."""
    tok = handler.server.token
    if not tok:
        return True
    given = handler.get_argument("token", None)
    if given is not None and hmac.compare_digest(given.encode(), tok.encode()):
        handler.set_cookie("ss_token", tok, httponly=True, samesite="Strict",
                           secure=handler.request.protocol == "https", expires_days=1)
        return True
    c = handler.get_cookie("ss_token")
    return c is not None and hmac.compare_digest(c.encode(), tok.encode())


class WSHandler(tornado.websocket.WebSocketHandler):
    def initialize(self, server):
        self.server = server

    def prepare(self):
        if not _token_ok(self):
            raise tornado.web.HTTPError(403)

    def check_origin(self, origin):
        return True

    def open(self):
        self.set_nodelay(True)
        self.server.on_open(self)

    def on_message(self, message):
        if isinstance(message, bytes):
            return
        msg = json.loads(message)
        srv = self.server
        at = srv.net.up_at(time.perf_counter())
        delay = max(0.0, at - time.perf_counter())
        if delay <= 0:
            srv.dispatch(self, msg)
        else:
            tornado.ioloop.IOLoop.current().call_later(delay, srv.dispatch, self, msg)

    def on_close(self):
        self.server.on_close(self)


class NoCache(tornado.web.StaticFileHandler):
    def initialize(self, server=None, **kw):
        self.server = server
        super().initialize(**kw)

    def prepare(self):
        if self.server is not None and not _token_ok(self):
            raise tornado.web.HTTPError(403)

    def set_extra_headers(self, path):
        self.set_header("Cache-Control", "no-store")


class StatsHandler(tornado.web.RequestHandler):
    def initialize(self, server):
        self.server = server

    def prepare(self):
        if not _token_ok(self):
            raise tornado.web.HTTPError(403)

    def get(self):
        s = self.server.session
        self.set_header("Content-Type", "application/json")
        self.write(json.dumps(list(s.log)[-200:] if s else []))


class ShellServer:
    def __init__(self, builder, port=8765, max_rate=30.0, idle_interval=0.5, max_inflight=2,
                 net: NetEmu | None = None, animate=True, address="127.0.0.1", max_refine=2, refine_delay=0.15,
                 token=None, ssl_ctx=None, audio=False):
        self.builder = builder
        self.token, self.ssl_ctx, self.audio = token, ssl_ctx, audio
        self.max_refine, self.refine_delay = max_refine, refine_delay
        self.port = port
        self.address = address
        self.max_rate = max_rate
        self.idle_interval = idle_interval
        self.max_inflight = max_inflight
        self.net = net or NetEmu()
        self.animate = animate
        self.session: Session | None = None
        self.loop = None
        self.ioloop = None
        self._thread = None
        if hasattr(builder, "world_info"):
            self.world = builder.world_info()
        else:
            self.world = {"type": "world", "spawns": builder.spawn_points(), "start": [0.0, 1.7, 24.0, 0.0]}
        self._started = threading.Event()

    # ---------------------------------------------------------- lifecycle
    def start(self):
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        self._started.wait(10)
        return self

    def _run(self):
        asyncio.set_event_loop(asyncio.new_event_loop())
        self.loop = asyncio.get_event_loop()
        app = tornado.web.Application([
            (r"/ws", WSHandler, dict(server=self)),
            (r"/stats", StatsHandler, dict(server=self)),
            (r"/(.*)", NoCache, dict(server=self, path=CLIENT_DIR, default_filename="index.html")),
        ], websocket_max_message_size=1 << 20, compress_response=False)
        self.http = app.listen(self.port, address=self.address, ssl_options=self.ssl_ctx)
        self.ioloop = tornado.ioloop.IOLoop.current()
        self._started.set()
        self.loop.run_forever()

    def stop(self):
        if self.session:
            self.session.close()
        if self.loop:
            def _stop():
                self.http.stop()
                self.loop.stop()
            self.loop.call_soon_threadsafe(_stop)

    # ---------------------------------------------------------- connections
    def on_open(self, h):
        self.opens = getattr(self, "opens", 0) + 1
        if self.session:                       # single player: a new tab replaces the old one
            self.session.close()
            try:
                self.session.h.close()
            except Exception:
                pass
        self.session = (HostSession if getattr(self.builder, "kind", "") == "host" else Session)(self, h)
        h.write_message(json.dumps(self.world))

    def on_close(self, h):
        if self.session and self.session.h is h:
            self.session.close()
            self.session = None

    def dispatch(self, h, msg):
        if self.session and self.session.h is h:
            self.session.on_message(msg)

    def send(self, h, data, binary):
        """thread-safe send with downlink emulation"""
        n = len(data)

        def _sched():
            at = self.net.down_at(time.perf_counter(), n)
            delay = max(0.0, at - time.perf_counter())

            def _w():
                try:
                    fut = h.write_message(data, binary=binary)
                    fut.add_done_callback(lambda f: f.exception())     # retrieve (and drop) close errors
                except tornado.websocket.WebSocketClosedError:
                    pass
            if delay <= 0:
                _w()
            else:
                self.ioloop.call_later(delay, _w)
        self.loop.call_soon_threadsafe(_sched)


def self_signed_cert(dirpath=None):
    """A self-signed certificate for --tls (kept in ~/.shellstream).  The browser warns once; compare the
    fingerprint printed here with the one it shows."""
    import datetime
    import hashlib
    import socket
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID
    d = dirpath or os.path.join(os.path.expanduser("~"), ".shellstream")
    os.makedirs(d, exist_ok=True)
    cert_p, key_p = os.path.join(d, "cert.pem"), os.path.join(d, "key.pem")
    if not (os.path.exists(cert_p) and os.path.exists(key_p)):
        key = ec.generate_private_key(ec.SECP256R1())
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "ShellStream " + socket.gethostname())])
        now = datetime.datetime.now(datetime.timezone.utc)
        cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
                .serial_number(x509.random_serial_number()).not_valid_before(now - datetime.timedelta(days=1))
                .not_valid_after(now + datetime.timedelta(days=365))
                .add_extension(x509.SubjectAlternativeName([x509.DNSName("localhost"), x509.DNSName(socket.gethostname())]),
                               critical=False)
                .sign(key, hashes.SHA256()))
        with open(key_p, "wb") as f:
            f.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                      serialization.NoEncryption()))
        os.chmod(key_p, 0o600)
        with open(cert_p, "wb") as f:
            f.write(cert.public_bytes(serialization.Encoding.PEM))
    c = x509.load_pem_x509_certificate(open(cert_p, "rb").read())
    fp = hashlib.sha256(c.public_bytes(serialization.Encoding.DER)).hexdigest().upper()
    print("TLS certificate SHA-256 fingerprint:", ":".join(fp[i:i + 2] for i in range(0, len(fp), 2)), flush=True)
    return cert_p, key_p


if __name__ == "__main__":   # standalone: python server.py [--cpu] [--port 8765]
    import argparse
    import engine as E
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--cpu", action="store_true")
    ap.add_argument("--budget", type=float, default=1.0e6)
    ap.add_argument("--omni", type=int, default=256)
    ap.add_argument("--quality", default="high")
    ap.add_argument("--rate", type=float, default=None, help="updates/frames per second (shell 30, game host 60)")
    ap.add_argument("--up", type=float, default=0); ap.add_argument("--down", type=float, default=0)
    ap.add_argument("--address", default="127.0.0.1")
    ap.add_argument("--threads", type=int, default=None)
    ap.add_argument("--game", nargs="+", default=None,
                    help="host mode: command line of ANY game to run and stream, e.g. --game minetest or --game /path/to/game")
    ap.add_argument("--size", default="1280x720", help="host mode: game window size")
    ap.add_argument("--fov", type=float, default=None, help="host mode: the game's vertical field of view, if known")
    ap.add_argument("--overscan", type=float, default=1.0, help="host mode: game FOV / displayed FOV (guard band)")
    ap.add_argument("--display", default=None, help="host mode: existing X display (e.g. a GPU-backed :0); default: new Xvfb")
    ap.add_argument("--launcher", default="", help="host mode: prefix, e.g. 'vglrun -d egl0' to render the game on a T4")
    ap.add_argument("--encode-gpu", type=int, default=1, help="host mode: which T4's NVENC encodes (keep the game's GPU free)")
    ap.add_argument("--host", action="store_true",
                    help="host mode without launching anything: stream this machine's screen (e.g. a Windows VM running Roblox)")
    ap.add_argument("--desktop", action="store_true", help="host mode: stream the whole screen, not just the game's window")
    ap.add_argument("--window", default=None, help="host mode: stream only the window whose title contains this text")
    ap.add_argument("--fps", type=float, default=None, help="host mode: capture and stream rate (default 60)")
    ap.add_argument("--bitrate", type=float, default=None, help="host mode: H.264 Mbit/s (default about 0.1 bit per pixel)")
    ap.add_argument("--audio", action="store_true", help="host mode: stream the machine's sound output (Opus)")
    ap.add_argument("--token", default="auto",
                    help="access token: 'auto' (random, required whenever --address isn't local), a value, @file, or 'none'")
    ap.add_argument("--tls", action="store_true",
                    help="HTTPS with a self-signed certificate (browsers decode H.264/Opus only on HTTPS or localhost)")
    ap.add_argument("--certfile", default=None); ap.add_argument("--keyfile", default=None)
    a = ap.parse_args()
    import secrets
    if a.token.startswith("@"):                     # --token @file: keep it out of process listings
        a.token = open(a.token[1:]).read().strip()
    local = a.address in ("127.0.0.1", "localhost", "::1")
    token = None if a.token == "none" else (secrets.token_urlsafe(18) if a.token == "auto" and not local else
                                            (None if a.token == "auto" else a.token))
    ssl_ctx = None
    if a.tls or a.certfile:
        import ssl
        cert, key = (a.certfile, a.keyfile) if a.certfile else self_signed_cert()
        ssl_ctx = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        ssl_ctx.load_cert_chain(cert, key)
    scheme = "https" if ssl_ctx else "http"
    shown = "127.0.0.1" if a.address in ("0.0.0.0", "::") else a.address
    url = f"{scheme}://{shown}:{a.port}/" + (f"?token={token}" if token else "")
    import signal

    def _term(*_):                                 # SIGTERM (e.g. from a supervisor) shuts down like Ctrl+C,
        raise KeyboardInterrupt                    # so the game and its virtual display are cleaned up
    signal.signal(signal.SIGTERM, _term)
    if a.game or a.host:
        import host as H
        w, h = (int(v) for v in a.size.split("x"))
        mt = a.game == ["minetest"]
        cmd = H.minetest_command(os.path.abspath("minetest_run"), w, h, fov=a.fov or 90) if mt else a.game
        fps = a.fps or a.rate or 60
        gh = H.GameHost(cmd, size=(w, h), display=a.display, fov_v=a.fov or (90 if mt else None),
                        overscan=a.overscan, fps=fps, gpu=a.encode_gpu, launcher=a.launcher.split(),
                        bitrate=a.bitrate * 1e6 if a.bitrate else None, window_name=a.window,
                        desktop=a.desktop or (a.host and not a.window))
        s = ShellServer(gh, port=a.port, max_rate=fps, net=NetEmu(a.up, a.down), address=a.address,
                        token=token, ssl_ctx=ssl_ctx, audio=a.audio).start()
        print(f"ShellStream game host: {url}  ({gh.w}x{gh.h} at {fps:g} fps, encoder={gh.world_info()['encoder']}"
              + (f", H.264 unavailable: {gh.video_error}" if getattr(gh, "video_error", None) else "") + ")", flush=True)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            s.stop(); gh.close()
        raise SystemExit
    n = 0 if a.cpu else E.cuda_device_count()
    bes = [E.CudaBackend(i) for i in range(min(n, 2))] if n else [E.CpuBackend(threads=a.threads)]
    b = E.ShellBuilder(bes, focus_budget=a.budget, omni_R=a.omni, quality=a.quality)
    s = ShellServer(b, port=a.port, max_rate=a.rate or 30, net=NetEmu(a.up, a.down), address=a.address,
                    token=token, ssl_ctx=ssl_ctx).start()
    print(f"ShellStream on {url}  backends={[x.device_name for x in bes]}")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        s.stop()
