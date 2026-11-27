#!/usr/bin/env python3
"""
void_vigil_film.py - VOID VIGIL, the cinematic cut.

Renders the shots in film/shots.py at 1920x1080, 24 fps, letterboxed to
2.39:1, adds the impact frames, flashes, camera shake and film look, and
lays the picture over shade_finale.mp3.

Usage:  python3 void_vigil_film.py                     -> void_vigil_film.mp4
        python3 void_vigil_film.py --stills T1 T2 ...  -> film_stills.png
"""
import math
import multiprocessing as mp
import subprocess
import sys

import numpy as np
import skia
from PIL import Image

from film import fx, shots
from film.draw import snapshot

FPS = 24
W, H = 1920, 1080
END = 123.9
TITLE_AT = 121.6

_surface = None


def render(t):
    global _surface
    if _surface is None:
        _surface = skia.Surface(W, H)
    cv = _surface.getCanvas()
    cv.clear(skia.Color(0, 0, 0))
    if t >= TITLE_AT:
        a = min(1, (t - TITLE_AT) / 0.6) * (1 - max(0, (t - (END - 0.8)) / 0.8))
        fx.title(cv, 'VOID VIGIL', 572, a, size=96)
        return fx.film_look(snapshot(_surface), t)
    for t0, t1, shot in shots.SHOTS:
        if t0 <= t < t1:
            cv.save()
            shot(cv, t, (t - t0) / (t1 - t0))
            cv.restore()
            break
    img = snapshot(_surface).copy()
    for it, mode in shots.IMPACTS:
        if 0 <= t - it < 2.5 / FPS:
            img = fx.impact(img, mode)
    amp = 0.0
    for st, dur, a in shots.SHAKES:
        if st <= t < st + dur:
            amp = max(amp, a * (1 - (t - st) / dur))
    img = fx.shake(img, amp, t)
    f = 0.0
    for ft, dur, a in shots.FLASHES:
        if t >= ft:
            f = max(f, a * math.exp(-(t - ft) / dur))
    img = fx.flash(img, f)
    # open on the title over darkness; the Abyss fades in behind it
    fade = max(1 - (t - 3.0) / 2.6 if t < 5.6 else 0.0, (t - 120.9) / 0.7, 0.0)
    img = fx.fade(img, min(1.0, fade))
    a = min(1.0, max(0.0, (t - 0.5) / 1.2)) * (1 - min(1.0, max(0.0, (t - 4.2) / 1.4)))
    if a > 0:
        img = fx.overlay_title(img, 'VOID VIGIL', a)
    return fx.film_look(img, t)


def frame(k):
    return render(k / FPS).tobytes()


def stills(times, path='film_stills.png'):
    ims = [Image.fromarray(render(t)).resize((640, 360)) for t in times]
    cols = 3
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * 644, rows * 364))
    for i, im in enumerate(ims):
        sheet.paste(im, ((i % cols) * 644, (i // cols) * 364))
    sheet.save(path)
    print('wrote', path)


def main():
    if '--stills' in sys.argv:
        i = sys.argv.index('--stills')
        args = sys.argv[i + 1:]
        out = 'film_stills.png'
        if args and args[-1].endswith('.png'):
            out = args.pop()
        stills([float(a) for a in args], out)
        return
    out = 'void_vigil_film.mp4'
    n = int(END * FPS)
    ff = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo',
                           '-pix_fmt', 'rgb24', '-s', '%dx%d' % (W, H), '-r', str(FPS), '-i', '-',
                           '-i', 'shade_finale.mp3', '-vf', 'hqdn3d=2:2:5:5', '-c:v', 'libx264',
                           '-preset', 'slow', '-b:v', '4600k', '-maxrate', '6000k',
                           '-bufsize', '12000k', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k',
                           '-shortest', '-movflags', '+faststart', out], stdin=subprocess.PIPE)
    with mp.Pool(4) as pool:
        for k, data in enumerate(pool.imap(frame, range(n), chunksize=6)):
            ff.stdin.write(data)
            if k % (FPS * 10) == 0:
                print('  %5.1f s' % (k / FPS), flush=True)
    ff.stdin.close()
    ff.wait()
    print('wrote', out)


if __name__ == '__main__':
    main()
