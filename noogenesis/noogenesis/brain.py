"""Typed-affinity neural tissue with evolved, neuromodulated plasticity.

Development (genome -> brain), run once at birth, fully batched:

  * the genome lists G_max neuron *types*; type g contributes count_g neurons.
    Neurons are packed contiguously (type 0 first), so the live part of every
    brain occupies slots [0, n_neurons). Each step the engine slices all brain
    tensors to N_eff = max(n_neurons) over the population: compute cost tracks
    the size of the brains evolution has actually built ("compute follows the
    brain"), not the size it could build.
  * recurrent wiring is a *genetic affinity* model:
        W_ij = s_t(i) * <q_t(i) + e_i , k_t(j) + e'_j> / sqrt(d * N_active)
    a rank-d structured connectome plus developmental noise: ~20 floats per
    type generate N^2 synapses (the genomic bottleneck).
  * vision: each type owns R separable receptive fields (channel x position);
    neurons are random mixtures of their type's basis -> cell-type-specific
    receptive-field motifs at ~1/6 of the cost of dense input weights.

Dynamics (every step):
    h' = (1 - a) h + a tanh((W + F) h + U x + b)                leaky integrators
    F' = clip(lam F + eta m (A h'_i h_j + B h_j + C h'_i + D))   fast weights
    m  = beta_0 + beta . mod(h')                                evolved neuromodulation

There is no designer-specified reward or loss. The "mod" channels are ordinary
outputs of the network; whether they come to signal value, surprise, pain or
nothing at all is decided by evolution.

Forward model ("predictive substrate"): a per-individual linear map P predicts
the next sensory/interoceptive summary from h and learns by a local delta
rule with an evolvable rate eta_pred (which may evolve to zero). Its error
magnitude is fed back as an interoceptive "surprise" signal.
"""
from __future__ import annotations

import math

import numpy as np

from .config import (BUILD, NA, N_PATCH, Config, n_other_inputs, n_outputs,
                     n_pred_targets, vision_channels)
from .genome import GenomeLayout, sigmoid, type_counts


def brain_spec(cfg: Config):
    """Per-agent brain arrays: name -> (trailing shape, dtype)."""
    N, C, R, G = cfg.N, vision_channels(cfg), cfg.R_vis, cfg.G_max
    f = np.float32
    return {
        "W": ((N, N), f), "F": ((N, N), f), "tidx": ((N,), np.int32),
        "chan": ((G * R, C), f), "posw": ((G * R, N_PATCH), f),
        "mix": ((N, R), f), "Uo": ((N, n_other_inputs(cfg)), f),
        "b": ((N,), f), "alpha": ((N,), f), "mask": ((N,), f),
        "eta": ((N,), f), "hebb": ((N, 4), f), "lam": ((N,), f),
        "beta": ((N, cfg.M_mod + 1), f), "V": ((n_outputs(cfg), N), f),
        "omask": ((n_outputs(cfg),), f),   # output repertoire fixed at birth
        "P": ((n_pred_targets(cfg), N), f), "h": ((N,), f),
        "pred": ((n_pred_targets(cfg),), f),
        "wiring": ((), f), "n_neurons": ((), f), "plast_sum": ((), f),
    }


def expressed_masks(xp, cfg: Config, physics):
    """Channel / input / output masks for physics that has not unfolded yet."""
    C = vision_channels(cfg)
    chan = np.ones(C, np.float32)
    chan[physics.k_active:cfg.K_max] = 0
    pher0 = cfg.K_max + 6
    chan[pher0 + physics.p_active:pher0 + cfg.P_max] = 0
    other = np.ones(n_other_inputs(cfg), np.float32)
    for pt in range(5):
        other[pt * cfg.S_max + physics.s_active:(pt + 1) * cfg.S_max] = 0
    out = np.ones(n_outputs(cfg), np.float32)
    if not physics.building:
        out[BUILD] = 0
    out[NA + physics.s_active:NA + cfg.S_max] = 0
    out[NA + cfg.S_max + physics.p_active:NA + cfg.S_max + cfg.P_max] = 0
    return xp.asarray(chan), xp.asarray(other), xp.asarray(out)


def packed_types(xp, counts, N):
    """counts (n, G) -> (tidx (n, N) type of each packed slot, mask (n, N),
    start (n, G) first slot of each type)."""
    ends = xp.cumsum(counts, axis=1)
    start = ends - counts
    j = xp.arange(N)
    tidx = (j[None, None, :] >= ends[:, :, None]).sum(1)
    mask = tidx < counts.shape[1]
    tidx = xp.minimum(tidx, counts.shape[1] - 1).astype(np.int32)
    return tidx, mask.astype(np.float32), start.astype(np.int32)


def develop(xp, rng, lay: GenomeLayout, g, physics):
    """Grow brains for a batch of genomes g (n, L). Returns dict of arrays."""
    cfg = lay.cfg
    n = g.shape[0]
    G, N, d, R = cfg.G_max, cfg.N, cfg.d_aff, cfg.R_vis
    C = vision_channels(cfg)
    T = lay.types(g)
    ts = lay.ts
    f32 = np.float32
    counts = type_counts(xp, lay, g)                     # (n, G)
    tidx, mask, _ = packed_types(xp, counts, N)
    n_act = mask.sum(1)
    nrm = xp.sqrt(xp.maximum(n_act, 1.0))

    def per_neuron(field):                               # (n, G, k) -> (n, N, k)
        return xp.take_along_axis(T[:, :, ts[field]], tidx[:, :, None], axis=1)

    sig = 0.3 * sigmoid(xp, per_neuron("dev_noise")[:, :, 0])           # (n, N)

    def noisy(field):
        base = per_neuron(field)
        eps = rng.standard_normal(base.shape, dtype=f32)
        return base + sig[:, :, None] * eps

    Q = noisy("q")
    K = noisy("k")
    ws = 1.5 * xp.tanh(per_neuron("w_scale")[:, :, 0])
    W = xp.matmul(Q, K.transpose(0, 2, 1)) / math.sqrt(d)
    W *= (ws / nrm[:, None])[:, :, None]
    W *= mask[:, :, None] * mask[:, None, :]

    chan_m, other_m, out_m = expressed_masks(xp, cfg, physics)
    gain_t = xp.exp(xp.clip(T[:, :, ts["in_gain"].start], -3.0, 1.0))  # (n, G)
    gain_n = xp.take_along_axis(gain_t, tidx, axis=1)                   # (n, N)
    chan = T[:, :, ts["vis_chan"]].reshape(n, G, R, C) * chan_m
    chan = chan * gain_t[:, :, None, None]   # sparse inputs: one food item must matter
    posw = T[:, :, ts["vis_pos"]].reshape(n, G, R, N_PATCH) / math.sqrt(N_PATCH)
    mix = noisy("vis_mix") * mask[:, :, None]
    Io = n_other_inputs(cfg)
    Uo = noisy("in_other") * other_m * (gain_n / math.sqrt(Io))[:, :, None]
    Uo *= mask[:, :, None]
    V = (noisy("out") * out_m * mask[:, :, None]).transpose(0, 2, 1) / nrm[:, None, None]
    eta = 0.1 * sigmoid(xp, per_neuron("eta")[:, :, 0] - 1.0) * mask
    return {
        "W": W.astype(f32),
        "F": xp.zeros((n, N, N), f32),
        "tidx": tidx,
        "chan": chan.reshape(n, G * R, C).astype(f32),
        "posw": posw.reshape(n, G * R, N_PATCH).astype(f32),
        "mix": mix.astype(f32),
        "Uo": Uo.astype(f32),
        "b": (0.5 * noisy("bias")[:, :, 0] * mask).astype(f32),
        "alpha": (0.02 + 0.98 * sigmoid(xp, per_neuron("alpha")[:, :, 0])).astype(f32),
        "mask": mask,
        "eta": eta.astype(f32),
        "hebb": xp.tanh(per_neuron("hebb")).astype(f32),
        "lam": (1.0 - 10.0 ** (-1.0 - 3.0 * sigmoid(xp, per_neuron("decay")[:, :, 0]))).astype(f32),
        "beta": xp.tanh(per_neuron("beta")).astype(f32),
        "V": V.astype(f32),
        "omask": xp.broadcast_to(out_m, (n, out_m.shape[0])).astype(f32),
        "P": xp.zeros((n, n_pred_targets(cfg), N), f32),
        "h": xp.zeros((n, N), f32),
        "pred": xp.zeros((n, n_pred_targets(cfg)), f32),
        "wiring": xp.abs(W).sum((1, 2)).astype(f32),
        "n_neurons": n_act.astype(f32),
        "plast_sum": eta.sum(1).astype(f32),
    }


def inherit_slot_map(xp, lay: GenomeLayout, g_parent, g_child):
    """For epigenetic inheritance: child slot j -> parent slot (or -1), matching
    neurons by (type, index within type). Robust to any genome change."""
    N = lay.cfg.N
    cp_, cc = type_counts(xp, lay, g_parent), type_counts(xp, lay, g_child)
    _, _, sp = packed_types(xp, cp_, N)
    tc, mc, sc = packed_types(xp, cc, N)
    r = xp.arange(N)[None, :] - xp.take_along_axis(sc, tc, axis=1)
    ok = (mc > 0) & (r < xp.take_along_axis(cp_, tc, axis=1))
    src = xp.take_along_axis(sp, tc, axis=1) + r
    return xp.where(ok, src, -1).astype(np.int32)


def inherit_fast_weights(xp, F_par, P_par, smap, rho):
    """Gather parental fast weights / forward model into child slot order."""
    ok = (smap >= 0).astype(np.float32)
    s = xp.maximum(smap, 0)
    Fr = xp.take_along_axis(F_par, s[:, :, None], axis=1)
    Fc = xp.take_along_axis(Fr, s[:, None, :], axis=2)
    Fc *= (ok[:, :, None] * ok[:, None, :]) * rho[:, None, None]
    Pc = xp.take_along_axis(P_par, s[:, None, :], axis=2) * ok[:, None, :] * rho[:, None, None]
    return Fc.astype(np.float32), Pc.astype(np.float32)


def brain_forward(xp, B, n, Ne, Xv, Xo, plastic_on=True):
    """One step for agents [0, n), neurons [0, Ne). Xv: (n, C, P) vision,
    Xo: (n, Io) other inputs. Returns (h_new (n, Ne), outputs (n, O))."""
    h = B["h"][:n, :Ne]
    R = B["mix"].shape[2]
    Gt = B["chan"].shape[1] // R
    Y = xp.matmul(B["chan"][:n], Xv)                       # (n, G*R, P)
    s = (Y * B["posw"][:n]).sum(-1).reshape(n, Gt, R)       # per-type responses
    s_n = xp.take_along_axis(s, B["tidx"][:n, :Ne, None], axis=1)  # (n, Ne, R)
    vis = (B["mix"][:n, :Ne] * s_n).sum(-1)
    oth = xp.matmul(B["Uo"][:n, :Ne], Xo[:, :, None])[:, :, 0]
    Wt = B["W"][:n, :Ne, :Ne]
    if plastic_on:
        Wt = Wt + B["F"][:n, :Ne, :Ne]
    rec = xp.matmul(Wt, h[:, :, None])[:, :, 0]
    pre = rec + vis + oth + B["b"][:n, :Ne]
    a = B["alpha"][:n, :Ne]
    h_new = ((1.0 - a) * h + a * xp.tanh(pre)) * B["mask"][:n, :Ne]
    out = xp.matmul(B["V"][:n, :, :Ne], h_new[:, :, None])[:, :, 0]
    return h_new.astype(np.float32), out


def plasticity(xp, B, n, Ne, h_pre, h_post, mod, F_clip, buf):
    """Generalised Hebbian update of fast weights, gated by neuromodulators.
    dF_ij = eta_i m_i (A_i post_i pre_j + B_i pre_j + C_i post_i + D_i)
          = g_i (a_i pre_j + c_i)     with g = eta m, a = A post + B, c = C post + D
    computed as one rank-2 batched matmul [g a, g c] @ [pre; mask]."""
    hb = B["hebb"][:n, :Ne]
    beta = B["beta"][:n, :Ne]
    m = beta[:, :, 0] + (beta[:, :, 1:] * mod[:, None, :]).sum(-1)
    g = B["eta"][:n, :Ne] * m
    left = xp.stack([g * (hb[:, :, 0] * h_post + hb[:, :, 1]),
                     g * (hb[:, :, 2] * h_post + hb[:, :, 3])], 2)      # (n, Ne, 2)
    right = xp.stack([h_pre, B["mask"][:n, :Ne]], 1)                   # (n, 2, Ne)
    dF = buf.reshape(-1)[:n * Ne * Ne].reshape(n, Ne, Ne)   # contiguous scratch
    xp.matmul(left, right, out=dF)
    F = B["F"][:n, :Ne, :Ne]
    F *= B["lam"][:n, :Ne, None]
    F += dF
    xp.clip(F, -F_clip, F_clip, out=F)


def forward_model_update(xp, B, n, Ne, eta_pred, target):
    """Delta rule for the predictive substrate; returns surprise (n,)."""
    err = target - B["pred"][:n]
    P = B["P"][:n, :, :Ne]
    P += (eta_pred[:, None] * err)[:, :, None] * B["h"][:n, None, :Ne]
    xp.clip(P, -3.0, 3.0, out=P)
    return xp.abs(err).mean(1)


def forward_model_predict(xp, B, n, Ne):
    return xp.matmul(B["P"][:n, :, :Ne], B["h"][:n, :Ne, None])[:, :, 0]
