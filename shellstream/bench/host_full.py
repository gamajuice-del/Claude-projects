"""Experiment H4: full remote control of an unmodified game through the browser, end to end, as a remote player
would use it (Minetest stands in for Roblox here; the Windows backend has the same interface):

  * access: no token -> 403; HTTPS (self-signed) gives a secure context, so WebCodecs decodes H.264 and Opus
  * pointer modes: in the game the pointer is hidden -> 'look' (relative counts, predicted); Escape opens the
    pause menu -> 'cursor' (absolute positions, local pointer); clicking "Continue" through the absolute pointer
    closes the menu -> 'look' again
  * the local pointer's display<->frame mapping round-trips
  * audio: a 440 Hz tone played on the host arrives, is decoded and scheduled in the browser
"""
import json
import os
import shutil
import ssl
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

import numpy as np

from common import RESULTS, ROOT, chromium_path, wait_for

W, H, PORT, TOKEN = 640, 360, 8947, "bench-token-123"
CONTINUE = (398, 139)                       # "Continue" in Minetest 5.6's pause menu at 640x360


def tone_player(stop):
    """a 440 Hz tone on the host's default output, like game audio"""
    code = ("import numpy as np, soundcard as sc, sys\n"
            "t = np.arange(48000 * 30) / 48000\n"
            "sc.default_speaker().play(0.3 * np.sin(2 * np.pi * 440 * t)[:, None].repeat(2, 1), samplerate=48000)\n")
    p = subprocess.Popen([sys.executable, "-c", code, "tone"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    stop.wait(); p.terminate()


def main():
    res = {}
    have_pulse = shutil.which("pulseaudio") is not None
    if have_pulse and subprocess.run(["pulseaudio", "--check"]).returncode != 0:
        subprocess.run(["pulseaudio", "-D", "--exit-idle-time=-1"], stderr=subprocess.DEVNULL)
        time.sleep(1)
    build = os.path.join(RESULTS, "..", "build")
    os.makedirs(build, exist_ok=True)
    log = open(os.path.join(build, "host_full_server.log"), "w")
    srv = subprocess.Popen([sys.executable, "-u", os.path.join(ROOT, "server.py"), "--game", "minetest", "--size", f"{W}x{H}",
                            "--fov", "90", "--overscan", "1.12", "--port", str(PORT), "--fps", "60", "--tls",
                            "--token", TOKEN] + (["--audio"] if have_pulse else []),
                           cwd=build, stdout=log, stderr=subprocess.STDOUT)
    stop = threading.Event()
    try:
        time.sleep(12)
        ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
        codes = {}
        for name, url in (("no token", f"https://127.0.0.1:{PORT}/"), ("wrong token", f"https://127.0.0.1:{PORT}/?token=x"),
                          ("token", f"https://127.0.0.1:{PORT}/?token={TOKEN}")):
            try:
                codes[name] = urllib.request.urlopen(url, context=ctx, timeout=5).status
            except urllib.error.HTTPError as e:
                codes[name] = e.code
        res["http_status"] = codes
        print("access:", codes, flush=True)
        if have_pulse:
            threading.Thread(target=tone_player, args=(stop,), daemon=True).start()
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            kw = dict(args=["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"])
            if chromium_path():
                kw["executable_path"] = chromium_path()
            br = p.chromium.launch(**kw)
            pg = br.new_context(ignore_https_errors=True, viewport={"width": W, "height": H}).new_page()
            pg.goto(f"https://127.0.0.1:{PORT}/?token={TOKEN}&test=1&w={W}&h={H}")
            wait_for(pg, "SS.host.active && SS.host.frames > 10", 90)
            env = pg.evaluate("({secure: window.isSecureContext, video: typeof VideoDecoder, audio: typeof AudioDecoder,"
                              " codec: SS.host.info.codec, decoder: !!SS.host.decoder})")
            res["browser"] = env
            print("browser:", env, flush=True)
            pg.evaluate("SS.hostBegin()")
            time.sleep(1.5)
            modes = {"in game": pg.evaluate("({look: SS.host.frame.look, cur: SS.host.frame.cur})")}
            pg.evaluate("SS.hostKey('Escape', 1); SS.hostKey('Escape', 0)")
            wait_for(pg, "SS.host.frame.look === false", 10)
            modes["pause menu"] = pg.evaluate("({look: SS.host.frame.look, cur: SS.host.frame.cur, predicted: SS.host.pendingRotation()})")
            # the local pointer, then a click, through absolute positions
            pg.evaluate(f"SS.host.pointTo({CONTINUE[0]}, {CONTINUE[1]}); SS.host.flush()")
            time.sleep(0.6)
            modes["pointer moved to Continue"] = pg.evaluate("({look: SS.host.frame.look, cur: SS.host.frame.cur})")
            pg.evaluate("SS.host.queue(['b', 0, 1]); SS.host.flush()"); time.sleep(0.1)
            pg.evaluate("SS.host.queue(['b', 0, 0]); SS.host.flush()")
            wait_for(pg, "SS.host.frame.look === true", 10)
            modes["after clicking Continue"] = pg.evaluate("({look: SS.host.frame.look, cur: SS.host.frame.cur})")
            res["pointer_modes"] = modes
            for k, v in modes.items():
                print(f"{k:28s}", v, flush=True)
            # display <-> frame mapping of the local pointer (worst round-trip error over the frame, px)
            res["pointer_mapping_err_px"] = pg.evaluate("""(() => { let e = 0; const H = SS.host;
                for (const [x, y] of [[0, 0], [100, 50], [320, 180], [639, 359], [400, 300]]) {
                  const [cx, cy] = H.toCss(x, y); const [fx, fy] = H.toFrame(cx, cy); e = Math.max(e, Math.hypot(fx - x, fy - y)); }
                return e; })()""")
            print("pointer mapping round-trip error (px):", round(res["pointer_mapping_err_px"], 4), flush=True)
            if have_pulse:
                time.sleep(3)
                a = pg.evaluate("SS.host.aStats")
                res["audio"] = a
                print("audio:", a, flush=True)
            br.close()
    finally:
        stop.set()
        srv.terminate(); log.close()
        time.sleep(1)
        subprocess.run(["pkill", "-f", "minetest_run"], check=False)
    ok = (res["http_status"] == {"no token": 403, "wrong token": 403, "token": 200}
          and res["browser"]["secure"] and res["browser"]["codec"] == "h264"
          and res["pointer_modes"]["in game"]["look"] is True and res["pointer_modes"]["pause menu"]["look"] is False
          and res["pointer_modes"]["after clicking Continue"]["look"] is True and res["pointer_mapping_err_px"] < 0.01
          and (not have_pulse or (res["audio"]["decoded"] > 50 and res["audio"]["rms"] > 0.05)))
    res["all_ok"] = bool(ok)
    print("ALL OK" if ok else "FAILED", flush=True)
    json.dump(res, open(os.path.join(RESULTS, "host_full.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
