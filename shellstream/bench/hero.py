"""Hero screenshot for the report: the real client, a real shell, client-side orbs lighting the cloud-rendered world."""
import math
import sys
import time

from PIL import Image
from playwright.sync_api import sync_playwright

from common import E, S, RESULTS, decode_capture, launch, wait_for

W, H = 960, 540


def main():
    b = E.ShellBuilder([E.CpuBackend()], focus_budget=0.75e6, omni_R=256, quality="high", spp=2)
    srv = S.ShellServer(b, port=8891, max_rate=5, animate=False).start()
    with sync_playwright() as p:
        br = launch(p)
        pg = br.new_page(viewport={"width": W, "height": H})
        pg.goto(f"http://127.0.0.1:8891/?test=1&w={W}&h={H}")
        wait_for(pg, "SS.stats.shells >= 1 && SS.game.orbs.length > 0", 120)
        pg.evaluate("SS.pause(true)")
        pos, yaw, pitch = [3.2, 1.7, 21.5], 0.32, 0.02
        # place a few orbs in view (client-owned objects; their light is rendered by the server)
        r, u, f = E.basis_from_yaw_pitch(yaw, 0)
        pts = []
        for k, (fw, side) in enumerate([(4.0, -1.2), (6.5, 1.8), (9.0, -2.8), (12.0, 0.6), (15.0, 3.2)]):
            q = [float(pos[0] + f[0] * fw + r[0] * side), 1.15, float(pos[2] + f[2] * fw + r[2] * side)]
            pts.append(q)
            pg.evaluate(f"SS.game.orbs[{k}].p = {q}; SS.game.orbs[{k}].y = {q[1]}")
        seq = pg.evaluate(f"SS.setPose({pos}, {yaw}, {pitch}), SS.sendNow()")
        wait_for(pg, f"SS.shell && SS.shell.in_seq >= {seq}", 300)
        pg.evaluate("SS.freezeShell(true)")
        img = decode_capture(pg.evaluate(f"SS.capture({pos}, {yaw}, {pitch}, 'shell')"))
        Image.fromarray(img).save(f"{RESULTS}/hero.png")
        # the same shell seen from 0.4 m to the right and 12 degrees further left: still coherent
        r0, _, _ = E.basis_from_yaw_pitch(yaw, pitch)
        P2 = [float(pos[0] + r0[0] * 0.4), pos[1], float(pos[2] + r0[2] * 0.4)]
        img2 = decode_capture(pg.evaluate(f"SS.capture({P2}, {yaw + math.radians(12)}, {pitch}, 'shell')"))
        Image.fromarray(img2).save(f"{RESULTS}/hero_moved.png")
        print("shell stats", pg.evaluate("SS.shell.stats"))
        br.close()
    srv.stop()


if __name__ == "__main__":
    sys.exit(main())
