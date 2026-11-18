"""Experiment H3: how fast can the game host stream?  The real pipeline (pointer state, calibrator hand-off,
change detection, H.264 encode) on a synthetic source that pans like mouse-look, at 720p and 1080p.

Capture is replaced by slicing a pre-rendered panorama (a fresh array per frame, as DXGI/X capture returns), so
the numbers are the host's own cost.  The encoder here is x264 on the CPU; on a T4 it is NVENC, whose speed the
notebook measures.  The calibrator runs on its own thread; `calibrated` is the share of frames it kept up with.
"""
import json
import os
import sys
import time

import numpy as np

from common import RESULTS, ROOT

sys.path.insert(0, ROOT)
import host as Hm  # noqa: E402


class PanGrab:
    def __init__(self, w, h):
        rng = np.random.default_rng(0)
        tex = (rng.random((h // 8 + 1, (w * 3) // 8)) * 255).astype(np.uint8)
        self.pan = np.repeat(np.repeat(tex, 8, 0), 8, 1)[:h]
        self.pan = np.stack([self.pan, self.pan // 2 + 60, 255 - self.pan], -1)
        self.w, self.h, self.x = w, h, 0

    def grab(self):
        self.x = (self.x + 6) % (self.pan.shape[1] - self.w)          # turning: 6 px per frame
        return np.ascontiguousarray(self.pan[:, self.x:self.x + self.w])


class FakeInj:
    cx = cy = 0

    def cursor(self):
        return False, None, None                                      # mouse-look

    def counts_at(self, t):
        return 0, 0


def run(w, h, n=240):
    gh = Hm.GameHost.from_backend(FakeInj(), PanGrab(w, h), (0, 0, w, h), fov_v=70, fps=240)
    cap, enc, t0 = [], [], time.perf_counter()
    for i in range(n):
        _, st = gh.produce(i, force=True)
        cap.append(st["capture_ms"]); enc.append(st["encode_ms"])
    dt = time.perf_counter() - t0
    time.sleep(0.3)
    res = dict(size=f"{w}x{h}", encoder=gh.video.name if gh.video else "jpeg", fps_max=round(n / dt, 1),
               ms_per_frame=round(1000 * dt / n, 2), capture_and_state_ms=round(float(np.median(cap)), 2),
               encode_ms=round(float(np.median(enc)), 2),
               calibrated=round(getattr(gh, "cal_updates", 0) / n, 2))
    # the calibrator's own cost at this size (sample grid scales with the frame, so it should stay flat)
    cal = Hm.Calibrator(fov_v=70); g = PanGrab(w, h); frames = [g.grab() for _ in range(40)]
    t1 = time.perf_counter()
    for k, f in enumerate(frames):
        cal.update(f, 6 * k, 0, t=k / 60)
    res["calibrator_ms"] = round(1000 * (time.perf_counter() - t1) / len(frames), 2)
    gh.close()
    return res


def main():
    rows = [run(1280, 720), run(1920, 1080)]
    for r in rows:
        print(r, flush=True)
    json.dump(rows, open(os.path.join(RESULTS, "host_fps.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
