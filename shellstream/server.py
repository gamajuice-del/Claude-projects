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
    encoding (video frames reference each other), so flow control acts *before* capture."""

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


class WSHandler(tornado.websocket.WebSocketHandler):
    def initialize(self, server):
        self.server = server

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
    def set_extra_headers(self, path):
        self.set_header("Cache-Control", "no-store")


class StatsHandler(tornado.web.RequestHandler):
    def initialize(self, server):
        self.server = server

    def get(self):
        s = self.server.session
        self.set_header("Content-Type", "application/json")
        self.write(json.dumps(list(s.log)[-200:] if s else []))


class ShellServer:
    def __init__(self, builder, port=8765, max_rate=30.0, idle_interval=0.5, max_inflight=2,
                 net: NetEmu | None = None, animate=True, address="127.0.0.1", max_refine=2, refine_delay=0.15):
        self.builder = builder
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
            (r"/(.*)", NoCache, dict(path=CLIENT_DIR, default_filename="index.html")),
        ], websocket_max_message_size=1 << 20, compress_response=False)
        self.http = app.listen(self.port, address=self.address)
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


if __name__ == "__main__":   # standalone: python server.py [--cpu] [--port 8765]
    import argparse
    import engine as E
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--cpu", action="store_true")
    ap.add_argument("--budget", type=float, default=1.0e6)
    ap.add_argument("--omni", type=int, default=256)
    ap.add_argument("--quality", default="high")
    ap.add_argument("--rate", type=float, default=30)
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
    a = ap.parse_args()
    import signal

    def _term(*_):                                 # SIGTERM (e.g. from a supervisor) shuts down like Ctrl+C,
        raise KeyboardInterrupt                    # so the game and its virtual display are cleaned up
    signal.signal(signal.SIGTERM, _term)
    if a.game:
        import host as H
        w, h = (int(v) for v in a.size.split("x"))
        cmd = H.minetest_command(os.path.abspath("minetest_run"), w, h, fov=a.fov or 90) if a.game == ["minetest"] else a.game
        gh = H.GameHost(cmd, size=(w, h), display=a.display, fov_v=a.fov or (90 if a.game == ["minetest"] else None),
                        overscan=a.overscan, fps=a.rate, gpu=a.encode_gpu, launcher=a.launcher.split())
        s = ShellServer(gh, port=a.port, max_rate=a.rate, net=NetEmu(a.up, a.down), address=a.address).start()
        print(f"ShellStream game host on http://{a.address}:{a.port}  encoder={gh.world_info()['encoder']}"
              + (f"  (H.264 unavailable: {gh.video_error})" if getattr(gh, "video_error", None) else ""))
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            s.stop(); gh.close()
        raise SystemExit
    n = 0 if a.cpu else E.cuda_device_count()
    bes = [E.CudaBackend(i) for i in range(min(n, 2))] if n else [E.CpuBackend(threads=a.threads)]
    b = E.ShellBuilder(bes, focus_budget=a.budget, omni_R=a.omni, quality=a.quality)
    s = ShellServer(b, port=a.port, max_rate=a.rate, net=NetEmu(a.up, a.down), address=a.address).start()
    print(f"ShellStream on http://{a.address}:{a.port}  backends={[x.device_name for x in bes]}")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        s.stop()
