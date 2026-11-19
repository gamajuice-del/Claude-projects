"""Pass 3 evaluation on Imagenette 64x64 (self-trained classifier features; NOT comparable to Inception FID).
  classifier : train it (once) and run the PREMISE check: how much class information does the finest Haar band
               carry at 64x64?  (accuracy / SC-FID of real val images with the finest band zeroed)
  generate   : FLOP-matched systems -> SC-FID, class accuracy, precision/recall, memorization."""
import json, os, sys, time
import numpy as np
import torch
import torch.nn.functional as F
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from crisp.common import RESULTS, save_json
from crisp.data import haar_fwd, haar_inv, load_imagenette
from crisp.edm import heun_sample
from generate_eval import fid, memorization, prec_recall
from train_classifier import Classifier
import train_imagenette as ti

PER_CLASS = 100
CLF = os.path.join(RESULTS, "classifier_imagenette64.pt")


def train_classifier(xtr, ytr, xte, yte, epochs=12):
    torch.manual_seed(0)
    net = Classifier()
    opt = torch.optim.SGD(net.parameters(), lr=0.05, momentum=0.9, weight_decay=5e-4, nesterov=True)
    steps = epochs * (len(xtr) // 128)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, 0.1, total_steps=steps)
    for ep in range(epochs):
        net.train()
        perm = torch.randperm(len(xtr))
        for i in range(0, len(xtr) - 127, 128):
            idx = perm[i:i + 128]; x = xtr[idx]
            flip = torch.rand(len(x)) < 0.5
            x = torch.where(flip[:, None, None, None], x.flip(3), x)
            x = F.pad(x, [6] * 4, mode="reflect"); dx, dy = torch.randint(0, 13, (2,))
            x = x[:, :, dy:dy + 64, dx:dx + 64]
            loss = F.cross_entropy(net(x), ytr[idx], label_smoothing=0.1)
            opt.zero_grad(); loss.backward(); opt.step(); sched.step()
        net.eval()
        with torch.no_grad():
            acc = float(torch.cat([net(xte[i:i + 500]).argmax(1) for i in range(0, len(xte), 500)]).eq(yte).float().mean())
        print(f"classifier epoch {ep} val acc {acc:.4f}", flush=True)
    torch.save(net.state_dict(), CLF)
    return net, acc


def zero_fine(x):
    ll, d = haar_fwd(x)
    return haar_inv(ll, torch.zeros_like(d))


def load(name, mode):
    ck = torch.load(os.path.join(RESULTS, "runs", name, "ema.pt"))
    m = ti.build(mode, ck["config"]["base"], ck["sigma_data"])
    m.net.load_state_dict(ck["state"])
    return m.eval()


@torch.no_grad()
def generate(system):
    ys = torch.arange(10).repeat_interleave(PER_CLASS)
    out = []
    if system == "edm64":
        m = load("in64_pix", "pix")
        for i in range(0, len(ys), 100):
            out.append(heun_sample(m, (len(ys[i:i + 100]), 3, 64, 64), ys[i:i + 100], seed=i))
    else:
        mc = load("in64_coarse", "coarse")
        md = load("in64_detail", "detail") if system == "pyramid" else None
        for i in range(0, len(ys), 100):
            yb = ys[i:i + 100]
            ll = heun_sample(mc, (len(yb), 3, 32, 32), yb, seed=i)
            if md is None:
                det = torch.zeros(len(yb), 9, 32, 32)
            else:
                det = heun_sample(lambda d, s, y: md(d, s, y, ll), (len(yb), 9, 32, 32), yb, n=18,
                                  smax=ti.DET_SMAX, smin=ti.DET_SMIN, seed=10_000 + i)
            out.append(haar_inv(ll, det))
    return torch.cat(out).clamp(-1, 1), ys


def main():
    torch.set_num_threads(4)
    what = sys.argv[1]
    xtr, ytr, xte, yte = load_imagenette(64)
    if what == "classifier":
        t0 = time.time()
        clf, acc = train_classifier(xtr, ytr, xte, yte)
        feats = lambda x: torch.cat([clf.features(x[i:i + 500]) for i in range(0, len(x), 500)])
        with torch.no_grad():
            fz, fr = feats(zero_fine(xte)), feats(xte)
            accz = float(clf.head(fz).argmax(1).eq(yte).float().mean())
            half = len(xte) // 2
            fid_real = fid(fr[:half].numpy(), fr[half:].numpy())
            fid_zero = fid(fz[:half].numpy(), fr[half:].numpy())
        res = dict(val_acc=acc, val_acc_finest_band_zeroed=accz, sc_fid_real_vs_real=fid_real,
                   sc_fid_zeroed_vs_real=fid_zero, seconds=time.time() - t0)
        print(res, flush=True)
        save_json(res, "imagenette_premise.json")
        return
    clf = Classifier(); clf.load_state_dict(torch.load(CLF)); clf.eval()
    feats = lambda x: torch.cat([clf.features(x[i:i + 500]) for i in range(0, len(x), 500)])
    with torch.no_grad():
        ft = feats(xte)
    p = os.path.join(RESULTS, "imagenette_generation.json")
    results = json.load(open(p)) if os.path.exists(p) else {}
    for system in sys.argv[2].split(","):
        t0 = time.time()
        x, ys = generate(system)
        secs = time.time() - t0
        with torch.no_grad():
            fg = feats(x)
            acc = float(clf.head(fg).argmax(1).eq(ys).float().mean())
        pr, rc = prec_recall(ft[:1000], fg)
        mem, d1 = memorization(x, xtr)
        results[system] = dict(sc_fid=fid(fg.numpy(), ft.numpy()), class_acc=acc, precision=pr, recall=rc,
                               memorized_frac=mem, mean_nn_dist=d1, sample_seconds=secs, n=len(x))
        print(system, results[system], flush=True)
        np.savez_compressed(os.path.join(RESULTS, f"samples_in64_{system}.npz"),
                            x=((x + 1) * 127.5).round().clamp(0, 255).byte().numpy(), y=ys.numpy())
        save_json(results, "imagenette_generation.json")


if __name__ == "__main__":
    main()
