"""Self-trained CIFAR-10 classifier used ONLY for evaluation (feature space for SC-FID, precision /
recall, and class accuracy of conditional samples).  No pretrained weights exist in this sandbox,
and using any would also violate the no-external-components rule, so all metrics here are
self-consistent but NOT comparable to published Inception-FID numbers."""
import os
import sys
import time

import torch
import torch.nn as nn
import torch.nn.functional as F

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from crisp.common import RESULTS, save_json
from crisp.data import load_cifar10


def block(cin, cout):
    return nn.Sequential(nn.Conv2d(cin, cout, 3, padding=1, bias=False), nn.BatchNorm2d(cout), nn.ReLU(inplace=True))


class Classifier(nn.Module):
    def __init__(self):
        super().__init__()
        self.f = nn.Sequential(block(3, 64), block(64, 64), nn.MaxPool2d(2),
                               block(64, 128), block(128, 128), nn.MaxPool2d(2),
                               block(128, 256), block(256, 256), nn.MaxPool2d(2),
                               nn.AdaptiveAvgPool2d(1), nn.Flatten(), nn.Linear(256, 128), nn.ReLU(inplace=True))
        self.head = nn.Linear(128, 10)

    def features(self, x):
        return self.f(x)

    def forward(self, x):
        return self.head(self.f(x))


def main():
    torch.set_num_threads(int(sys.argv[1]) if len(sys.argv) > 1 else 4)
    epochs = int(sys.argv[2]) if len(sys.argv) > 2 else 6
    torch.manual_seed(0)
    xtr, ytr, xte, yte = load_cifar10()
    net = Classifier()
    opt = torch.optim.SGD(net.parameters(), lr=0.05, momentum=0.9, weight_decay=5e-4, nesterov=True)
    steps = epochs * (len(xtr) // 128)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, 0.1, total_steps=steps)
    t0 = time.time()
    for ep in range(epochs):
        net.train()
        perm = torch.randperm(len(xtr))
        for i in range(0, len(xtr) - 127, 128):
            idx = perm[i:i + 128]
            x = xtr[idx]
            flip = torch.rand(len(x)) < 0.5
            x = torch.where(flip[:, None, None, None], x.flip(3), x)
            x = F.pad(x, [4] * 4, mode="reflect")
            dx, dy = torch.randint(0, 9, (2,))
            x = x[:, :, dy:dy + 32, dx:dx + 32]
            loss = F.cross_entropy(net(x), ytr[idx], label_smoothing=0.1)
            opt.zero_grad(); loss.backward(); opt.step(); sched.step()
        net.eval()
        with torch.no_grad():
            acc = float(torch.cat([net(xte[i:i + 500]).argmax(1) for i in range(0, len(xte), 500)]).eq(yte).float().mean())
        print(f"epoch {ep} test acc {acc:.4f} t {time.time() - t0:.0f}s", flush=True)
    torch.save(net.state_dict(), os.path.join(RESULTS, "classifier.pt"))
    save_json(dict(test_acc=acc, epochs=epochs, seconds=time.time() - t0), "classifier.json")


if __name__ == "__main__":
    main()
