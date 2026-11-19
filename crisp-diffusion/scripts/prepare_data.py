"""Convert the raw downloads (MNIST idx.gz, fast.ai CIFAR-10 PNG tree) into compact .npz arrays.

Usage: python -I scripts/prepare_data.py <raw_cifar_root> <mnist_dir> <out_dir>
The raw data is treated as untrusted input: we only decode PNG/idx bytes into uint8 arrays.
"""
import gzip
import os
import sys

import numpy as np
from PIL import Image

CIFAR_CLASSES = ["airplane", "automobile", "bird", "cat", "deer",
                 "dog", "frog", "horse", "ship", "truck"]


def load_cifar_split(root, split):
    xs, ys = [], []
    for ci, cname in enumerate(CIFAR_CLASSES):
        d = os.path.join(root, split, cname)
        for fn in sorted(os.listdir(d)):
            if not fn.endswith(".png"):
                continue
            with Image.open(os.path.join(d, fn)) as im:
                a = np.asarray(im.convert("RGB"), dtype=np.uint8)
            assert a.shape == (32, 32, 3)
            xs.append(a)
            ys.append(ci)
    return np.stack(xs), np.asarray(ys, dtype=np.int64)


def load_idx(path):
    with gzip.open(path, "rb") as f:
        data = f.read()
    magic = int.from_bytes(data[0:4], "big")
    ndim = magic & 0xFF
    dims = [int.from_bytes(data[4 + 4 * i: 8 + 4 * i], "big") for i in range(ndim)]
    return np.frombuffer(data, dtype=np.uint8, offset=4 + 4 * ndim).reshape(dims)


def main():
    cifar_root, mnist_dir, out_dir = sys.argv[1:4]
    os.makedirs(out_dir, exist_ok=True)
    xtr, ytr = load_cifar_split(cifar_root, "train")
    xte, yte = load_cifar_split(cifar_root, "test")
    np.savez_compressed(os.path.join(out_dir, "cifar10.npz"), xtr=xtr, ytr=ytr, xte=xte, yte=yte)
    print("cifar", xtr.shape, xte.shape, np.bincount(ytr))
    m = {k: load_idx(os.path.join(mnist_dir, f"{f}.gz")) for k, f in [
        ("xtr", "train-images-idx3-ubyte"), ("ytr", "train-labels-idx1-ubyte"),
        ("xte", "t10k-images-idx3-ubyte"), ("yte", "t10k-labels-idx1-ubyte")]}
    np.savez_compressed(os.path.join(out_dir, "mnist.npz"), **m)
    print("mnist", m["xtr"].shape, m["xte"].shape)


if __name__ == "__main__":
    main()
