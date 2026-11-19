"""Imagenette (fast.ai, 160px) -> 64x64 center-cropped uint8 arrays.  Untrusted input: decode only.
Usage: python -I scripts/prepare_imagenette.py <imagenette2-160 root> <out_dir> [res]"""
import os
import sys

import numpy as np
from PIL import Image


def load(root, split, res):
    classes = sorted(d for d in os.listdir(os.path.join(root, split)) if not d.startswith("."))
    xs, ys = [], []
    for ci, c in enumerate(classes):
        d = os.path.join(root, split, c)
        for fn in sorted(os.listdir(d)):
            if not fn.lower().endswith((".jpeg", ".jpg")):
                continue
            with Image.open(os.path.join(d, fn)) as im:
                im = im.convert("RGB")
                w, h = im.size
                s = min(w, h)
                im = im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s)).resize((res, res), Image.BICUBIC)
                xs.append(np.asarray(im, dtype=np.uint8))
                ys.append(ci)
    return np.stack(xs), np.asarray(ys, dtype=np.int64), classes


def main():
    root, out = sys.argv[1], sys.argv[2]
    res = int(sys.argv[3]) if len(sys.argv) > 3 else 64
    xtr, ytr, classes = load(root, "train", res)
    xte, yte, _ = load(root, "val", res)
    np.savez_compressed(os.path.join(out, f"imagenette{res}.npz"), xtr=xtr, ytr=ytr, xte=xte, yte=yte)
    print(xtr.shape, xte.shape, np.bincount(ytr), classes)


if __name__ == "__main__":
    main()
