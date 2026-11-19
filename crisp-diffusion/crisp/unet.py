"""A compact class-conditional U-Net (DDPM++-style, scaled down for CPU experiments)."""
import math

import torch
import torch.nn as nn
import torch.nn.functional as F


class FourierEmb(nn.Module):
    def __init__(self, dim, scale=16.0):
        super().__init__()
        self.register_buffer("freqs", torch.randn(dim // 2) * scale)

    def forward(self, t):
        a = t[:, None] * self.freqs[None, :] * 2 * math.pi
        return torch.cat([a.cos(), a.sin()], 1)


def gn(c):
    g = max(k for k in range(1, 33) if c % k == 0 and c // k >= 4)
    return nn.GroupNorm(g, c)


class ResBlock(nn.Module):
    def __init__(self, cin, cout, emb):
        super().__init__()
        self.n1, self.c1 = gn(cin), nn.Conv2d(cin, cout, 3, padding=1)
        self.e = nn.Linear(emb, 2 * cout)
        self.n2, self.c2 = gn(cout), nn.Conv2d(cout, cout, 3, padding=1)
        self.skip = nn.Conv2d(cin, cout, 1) if cin != cout else nn.Identity()

    def forward(self, x, emb):
        h = self.c1(F.silu(self.n1(x)))
        s, b = self.e(emb)[:, :, None, None].chunk(2, 1)
        h = F.silu(self.n2(h) * (1 + s) + b)
        return (self.skip(x) + self.c2(h)) / math.sqrt(2)


class Attn(nn.Module):
    def __init__(self, c, heads=4):
        super().__init__()
        self.n, self.qkv, self.o, self.h = gn(c), nn.Conv2d(c, 3 * c, 1), nn.Conv2d(c, c, 1), heads

    def forward(self, x):
        B, C, H, W = x.shape
        q, k, v = self.qkv(self.n(x)).reshape(B, 3, self.h, C // self.h, H * W).unbind(1)
        a = F.scaled_dot_product_attention(q.transpose(-1, -2), k.transpose(-1, -2), v.transpose(-1, -2))
        return (x + self.o(a.transpose(-1, -2).reshape(B, C, H, W))) / math.sqrt(2)


class UNet(nn.Module):
    def __init__(self, in_ch, out_ch, base=64, mults=(1, 2, 2), nres=2, num_classes=10, attn_lowest=True):
        super().__init__()
        emb = 4 * base
        self.temb = nn.Sequential(FourierEmb(base), nn.Linear(base, emb), nn.SiLU(), nn.Linear(emb, emb))
        self.cemb = nn.Embedding(num_classes, emb) if num_classes else None
        self.inp = nn.Conv2d(in_ch, base, 3, padding=1)
        chans = [base * m for m in mults]
        self.down, self.up = nn.ModuleList(), nn.ModuleList()
        c, skips = base, [base]
        for i, ch in enumerate(chans):
            for _ in range(nres):
                self.down.append(ResBlock(c, ch, emb)); c = ch; skips.append(c)
            if i < len(chans) - 1:
                self.down.append(nn.Conv2d(c, c, 3, stride=2, padding=1)); skips.append(c)
        self.mid1, self.mid_attn, self.mid2 = ResBlock(c, c, emb), (Attn(c) if attn_lowest else nn.Identity()), ResBlock(c, c, emb)
        for i, ch in reversed(list(enumerate(chans))):
            for _ in range(nres + 1):
                self.up.append(ResBlock(c + skips.pop(), ch, emb)); c = ch
            if i > 0:
                self.up.append(nn.Upsample(scale_factor=2, mode="nearest"))
        self.out_norm, self.out = gn(c), nn.Conv2d(c, out_ch, 3, padding=1)
        nn.init.zeros_(self.out.weight); nn.init.zeros_(self.out.bias)

    def forward(self, x, c_noise, y=None):
        emb = self.temb(c_noise)
        if self.cemb is not None and y is not None:
            emb = emb + self.cemb(y)
        h = self.inp(x)
        hs = [h]
        for m in self.down:
            h = m(h, emb) if isinstance(m, ResBlock) else m(h)
            hs.append(h)
        h = self.mid2(self.mid_attn(self.mid1(h, emb)), emb)
        for m in self.up:
            if isinstance(m, ResBlock):
                h = m(torch.cat([h, hs.pop()], 1), emb)
            else:
                h = m(h)
        return self.out(F.silu(self.out_norm(h)))
