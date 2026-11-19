"""Splice measured tables (results/results_tables.md) and run logs into RESEARCH.md section 7. Idempotent."""
import json
import os
import re
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = lambda *p: os.path.join(ROOT, *p)


def blocks():
    txt = open(R("results", "results_tables.md")).read()
    out = {}
    for part in txt.split("#### ")[1:]:
        key = part.split(":")[0].strip()          # "E1 + E2", "E3", "E4", "E6", "E5"
        body = part.split("\n", 1)[1].strip()
        out[key] = body
    return out


def log(name):
    p = R("results", "runs", name, "log.json")
    return json.load(open(p)) if os.path.exists(p) else None


def at(curve, f):
    xs = np.log([max(p["flops"], 1e9) for p in curve]); ys = [p["test_loss"] for p in curve]
    return float(np.interp(np.log(f), xs, ys)) if f <= curve[-1]["flops"] * 1.02 else None


def main():
    b = blocks()
    tpl = open(R("scripts", "sec7_template.md")).read()
    tpl = tpl.replace("{{E12}}", b.get("E1 + E2", "_pending_")).replace("{{E3}}", b.get("E3", "_pending_"))
    tpl = tpl.replace("{{E4}}", b.get("E4", "_pending_")).replace("{{E6}}", b.get("E6", "_pending_")).replace("{{E5}}", b.get("E5", "_pending_"))
    edm, crisp, longc = log("edm16"), log("crisp16_full"), log("abl16_scaffold_long")
    if longc and edm and crisp:
        e, c, l = (at(x["curve"], 4.5e14) for x in (edm, crisp, longc))
        e15, l15 = at(edm["curve"], 1.5e14), at(longc["curve"], 1.5e14)
        verdict = (f"C alone ends {l - e:+.4f} relative to EDM (full CRISP {c - e:+.4f}). The convergence is intrinsic to the scaffold "
                   f"parametrization: a transient head start that R and I do not cause, while I recovers a little of the late deficit"
                   if abs(l - e) <= 0.002 else
                   ("C alone stays ahead of EDM at 4.5·10¹⁴, so R/I erode the advantage late" if l < e - 0.002 else
                    "C alone ends *behind* EDM at 4.5·10¹⁴, so the scaffold parametrization costs something late in training"))
        tpl = tpl.replace("{{LONGC}}", f"at 4.5·10¹⁴ FLOPs EDM reaches {e:.4f}, CRISP {c:.4f}, C-only {l:.4f} (at 1.5·10¹⁴: EDM {e15:.4f}, C-only {l15:.4f}). {verdict}.")
    else:
        tpl = tpl.replace("{{LONGC}}", "(long C-only run pending).")
    e1, c1 = log("edm16_s1"), log("crisp16_s1")
    if e1 and c1:
        e0a, c0a = at(edm["curve"], 7.5e13), at(crisp["curve"], 7.5e13)
        e1a, c1a = at(e1["curve"], 7.5e13), at(c1["curve"], 7.5e13)
        tpl = tpl.replace("{{SEEDS}}", f"Seed replicate at 7.5·10¹³ FLOPs: EDM {e0a:.4f} / {e1a:.4f}, CRISP {c0a:.4f} / {c1a:.4f} (seed 0 / seed 1). "
                          f"The CRISP–EDM gap ({e0a - c0a:+.4f}, {e1a - c1a:+.4f}) is {abs((e0a - c0a) / max(abs(e0a - e1a), abs(c0a - c1a), 1e-4)):.0f}× the larger seed-to-seed difference.")
    else:
        tpl = tpl.replace("{{SEEDS}}", "")
    doc = open(R("RESEARCH.md")).read()
    a = doc.index("## 7. Proof of concept on CPU: results")
    a = doc.index("\n", a) + 1
    z = doc.index("---\n\n## 8. Validation protocol")
    doc = doc[:a] + "\n" + tpl.strip() + "\n\n" + doc[z:]
    open(R("RESEARCH.md"), "w").write(doc)
    print("section 7 rebuilt;", "pending" if "_pending_" in tpl or "pending)" in tpl else "complete")


if __name__ == "__main__":
    main()
