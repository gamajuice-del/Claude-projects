"""Small CFVG model: a context encoder plus a flow-matching video transformer.

Video (T=8, 3, 16, 16) -> patches of 2 frames x 2 x 2 px -> 4 x 8 x 8 = 256 tokens.

Context pathway options:
  bottleneck=N  : K reference clips -> encoder -> Perceiver resampler -> N tokens
  bottleneck=0  : 'direct' - the generator cross-attends to every reference token
"""
from __future__ import annotations

import math

import torch
import torch.nn as nn
import torch.nn.functional as F

from engine import H, W, T, VOCAB, NULL_TOKEN

PT, PS = 2, 2                       # temporal / spatial patch
NT, NH, NW = T // PT, H // PS, W // PS
N_TOK = NT * NH * NW
PATCH_DIM = 3 * PT * PS * PS


def patchify(x):                    # (B, T, 3, H, W) -> (B, N, D)
    B = x.shape[0]
    x = x.reshape(B, NT, PT, 3, NH, PS, NW, PS)
    x = x.permute(0, 1, 4, 6, 2, 3, 5, 7)
    return x.reshape(B, N_TOK, PATCH_DIM)


def unpatchify(x):                  # (B, N, D) -> (B, T, 3, H, W)
    B = x.shape[0]
    x = x.reshape(B, NT, NH, NW, PT, 3, PS, PS)
    x = x.permute(0, 1, 4, 5, 2, 6, 3, 7)
    return x.reshape(B, T, 3, H, W)


def sincos_pos(dim):
    """Fixed 3-D sin-cos position embedding (N_TOK, dim)."""
    grid = torch.stack(torch.meshgrid(torch.arange(NT), torch.arange(NH), torch.arange(NW),
                                      indexing="ij"), -1).reshape(-1, 3).float()
    per = dim // 6 * 2
    out = []
    for a in range(3):
        freqs = torch.exp(-math.log(100.0) * torch.arange(per // 2) / (per // 2))
        ang = grid[:, a:a + 1] * freqs[None]
        out += [ang.sin(), ang.cos()]
    pe = torch.cat(out, 1)
    return F.pad(pe, (0, dim - pe.shape[1]))


class Attn(nn.Module):
    def __init__(self, d, heads, kv_dim=None):
        super().__init__()
        self.h = heads
        self.q = nn.Linear(d, d)
        self.kv = nn.Linear(kv_dim or d, 2 * d)
        self.o = nn.Linear(d, d)

    def forward(self, x, ctx=None, mask=None):
        ctx = x if ctx is None else ctx
        B, N, D = x.shape
        q = self.q(x).view(B, N, self.h, -1).transpose(1, 2)
        k, v = self.kv(ctx).view(B, ctx.shape[1], 2, self.h, -1).permute(2, 0, 3, 1, 4)
        if mask is not None:                     # (B, M) True = keep
            mask = mask[:, None, None, :]
        y = F.scaled_dot_product_attention(q, k, v, attn_mask=mask)
        return self.o(y.transpose(1, 2).reshape(B, N, D))


class Block(nn.Module):
    """Self-attn, then context cross-attn, then text cross-attn, then MLP.
    Timestep conditioning through adaLN-style shift/scale/gate."""

    def __init__(self, d, heads, cross=("ctx", "text"), cond=True):
        super().__init__()
        self.cross_names = cross
        self.n1 = nn.LayerNorm(d, elementwise_affine=False)
        self.sa = Attn(d, heads)
        self.cross = nn.ModuleDict({n: Attn(d, heads) for n in cross})
        self.cn = nn.ModuleDict({n: nn.LayerNorm(d) for n in cross})
        self.n2 = nn.LayerNorm(d, elementwise_affine=False)
        self.mlp = nn.Sequential(nn.Linear(d, 4 * d), nn.GELU(), nn.Linear(4 * d, d))
        self.ada = nn.Linear(d, 6 * d) if cond else None
        if cond:
            nn.init.zeros_(self.ada.weight)
            nn.init.zeros_(self.ada.bias)

    def forward(self, x, c=None, conds=None, masks=None):
        if self.ada is not None:
            s1, b1, g1, s2, b2, g2 = self.ada(c)[:, None].chunk(6, -1)
        else:
            s1 = b1 = s2 = b2 = 0
            g1 = g2 = 1
        x = x + g1 * self.sa(self.n1(x) * (1 + s1) + b1)
        for n in self.cross_names:
            x = x + self.cross[n](self.cn[n](x), conds[n], (masks or {}).get(n))
        x = x + g2 * self.mlp(self.n2(x) * (1 + s2) + b2)
        return x


class ContextEncoder(nn.Module):
    """Encodes a *set* of K clips. No clip-index embedding: order-invariant."""

    def __init__(self, d, heads, depth, bottleneck):
        super().__init__()
        self.inp = nn.Linear(PATCH_DIM, d)
        self.register_buffer("pos", sincos_pos(d), persistent=False)
        self.blocks = nn.ModuleList([Block(d, heads, cross=(), cond=False) for _ in range(depth)])
        self.bottleneck = bottleneck
        if bottleneck:
            self.queries = nn.Parameter(torch.randn(bottleneck, d) * 0.02)
            self.resample = Attn(d, heads)
            self.post = Block(d, heads, cross=(), cond=False)
        self.out_norm = nn.LayerNorm(d)

    def forward(self, refs, ref_mask):
        B, K = refs.shape[:2]
        h = self.inp(patchify(refs.flatten(0, 1))) + self.pos
        for blk in self.blocks:                       # each clip encoded alone
            h = blk(h)
        h = h.view(B, K * N_TOK, -1)
        tok_mask = ref_mask.repeat_interleave(N_TOK, 1)
        if not self.bottleneck:
            return self.out_norm(h), tok_mask
        q = self.queries[None].expand(B, -1, -1)
        z = q + self.resample(q, h, tok_mask)        # attends over all clips' tokens
        z = self.post(z)
        return self.out_norm(z), None


class CFVG(nn.Module):
    def __init__(self, d=128, heads=4, depth=6, enc_depth=2, bottleneck=16, text_len=5):
        super().__init__()
        self.encoder = ContextEncoder(d, heads, enc_depth, bottleneck)
        self.inp = nn.Linear(PATCH_DIM, d)
        self.register_buffer("pos", sincos_pos(d), persistent=False)
        self.tok = nn.Embedding(VOCAB, d)
        self.text_pos = nn.Parameter(torch.randn(text_len, d) * 0.02)
        self.t_mlp = nn.Sequential(nn.Linear(d, d), nn.SiLU(), nn.Linear(d, d))
        self.blocks = nn.ModuleList([Block(d, heads) for _ in range(depth)])
        self.out_norm = nn.LayerNorm(d, elementwise_affine=False)
        self.out = nn.Linear(d, PATCH_DIM)
        nn.init.zeros_(self.out.weight)
        nn.init.zeros_(self.out.bias)
        # identity path from the noisy input, gated by time: lets the network keep
        # per-pixel detail (sensor noise) cheaply
        self.skip = nn.Linear(d, 1)
        self.d = d

    def t_embed(self, t):
        half = self.d // 2
        f = torch.exp(-math.log(1000.0) * torch.arange(half, device=t.device) / half)
        a = t[:, None] * 1000 * f[None]
        return self.t_mlp(torch.cat([a.sin(), a.cos()], 1))

    def encode(self, refs, ref_mask):
        return self.encoder(refs, ref_mask)

    def forward(self, x_t, t, ctx, ctx_mask, text):
        h = self.inp(patchify(x_t)) + self.pos
        c = self.t_embed(t)
        txt = self.tok(text) + self.text_pos[: text.shape[1]]
        conds = {"ctx": ctx, "text": txt}
        masks = {"ctx": ctx_mask} if ctx_mask is not None else None
        for blk in self.blocks:
            h = blk(h, c, conds, masks)
        gate = torch.sigmoid(self.skip(c)).view(-1, 1, 1, 1, 1)
        return gate * x_t + unpatchify(self.out(self.out_norm(h)))   # predicted clean video


def velocity(x_hat, x_t, t):
    """x-prediction -> rectified-flow velocity."""
    return (x_hat - x_t) / (1 - t).clamp(min=0.05).view(-1, 1, 1, 1, 1)


def flow_loss(model, refs, ref_mask, target, text, p_drop_text=0.1):
    """Rectified flow: x_t = t * x + (1 - t) * eps. The network predicts the clean
    video x; the loss is on the implied velocity v = x - eps."""
    B = target.shape[0]
    t = torch.sigmoid(torch.randn(B))                 # logit-normal timesteps
    eps = torch.randn_like(target)
    tt = t.view(B, 1, 1, 1, 1)
    x_t = tt * target + (1 - tt) * eps
    drop = torch.rand(B) < p_drop_text
    text = torch.where(drop[:, None], torch.full_like(text, NULL_TOKEN), text)
    ctx, ctx_mask = model.encode(refs, ref_mask)
    v = velocity(model(x_t, t, ctx, ctx_mask, text), x_t, t)
    return F.mse_loss(v.float(), target - eps)


@torch.no_grad()
def sample(model, refs, ref_mask, text, steps=24, text_scale=1.0, seed=0):
    """Euler sampler with optional text classifier-free guidance."""
    g = torch.Generator().manual_seed(seed)
    B = text.shape[0]
    x = torch.randn(B, T, 3, H, W, generator=g)
    ctx, ctx_mask = model.encode(refs, ref_mask)
    null = torch.full_like(text, NULL_TOKEN)
    ts = torch.linspace(0, 1, steps + 1)
    for i in range(steps):
        t = torch.full((B,), ts[i].item())
        v = velocity(model(x, t, ctx, ctx_mask, text), x, t)
        if text_scale != 1.0:
            v0 = velocity(model(x, t, ctx, ctx_mask, null), x, t)
            v = v0 + text_scale * (v - v0)
        x = x + (ts[i + 1] - ts[i]) * v
    return x.clamp(-1, 1)
