"""The Substrate: a driven, dissipative, energy-conserving 2-D universe.

Minimal physics retained (see docs/NOOGENESIS.md section 1.3 for the argument):
  conservation       every unit of energy is in a store or in the ledger
  external flux      sunlight -> vegetation is the only source of free energy
  locality           egocentric 5x5 vision, sound range 2, one body per cell
  partial observ.    night shrinks vision; caches are only smelled at range 1
  multiscale drive   day (120) < season (2400) < chaotic climate (~10^4-10^5)
  composable matter  K chemical species, meat, caches, walls, pheromones
  persistence        caches, walls and pheromone trails outlive their makers
  other minds        sound, colour, predation, sharing, mating
  costly cognition   every neuron, spike-like activation and synapse costs energy

All agent state is struct-of-arrays with a fixed slot capacity; the live
population is kept compact in slots [0, n) so every per-step operation is a
dense batched tensor op over views (no gather/scatter of brains).
"""
from __future__ import annotations

import copy
import math
from collections import defaultdict

import numpy as np

from .backend import fsum, get_xp, scatter_add, to_numpy
from .brain import (arc_learning_step, brain_forward, brain_spec, develop,
                    forward_model_predict,
                    forward_model_update, inherit_fast_weights,
                    inherit_slot_map, plasticity)
from .config import (ATTACK, BUILD, DROP, EAT, FWD, LEFT, NA, NOOP, PICK,
                     REPRO, RIGHT, SHARE, VIS_RADIUS, Config, vision_channels)
from .genome import (GenomeLayout, crossover, decode_globals, genome_distance,
                     mutate, random_genomes)
from .unfolding import Physics

F_DIR = np.array([[-1, 0], [0, 1], [1, 0], [0, -1]], np.int32)  # N E S W
R_DIR = np.array([[0, 1], [1, 0], [0, -1], [-1, 0]], np.int32)  # right of heading
PATCH = [(f, s) for f in range(VIS_RADIUS, -VIS_RADIUS - 1, -1)
         for s in range(-VIS_RADIUS, VIS_RADIUS + 1)]
FRONT_P = PATCH.index((1, 0))
CENTER_P = PATCH.index((0, 0))
SOUND_PTS = [(0, 0), (2, 0), (0, 2), (-2, 0), (0, -2)]  # own, front, right, back, left
N_SOUND_PTS_W = len(SOUND_PTS)

PHENO = ["size", "max_age", "repro_thr", "invest", "eff", "color", "compat",
         "eta_pred", "temp", "epi_rho", "share"]


class Agents:
    """Struct-of-arrays storage with compaction."""

    def __init__(self, cfg: Config, lay: GenomeLayout, xp):
        f, i, b = np.float32, np.int32, np.bool_
        spec = {
            "pos": ((2,), i), "heading": ((), i), "energy": ((), f),
            "health": ((), f), "age": ((), i), "structure": ((), f),
            "carry": ((cfg.K_max,), f), "last_action": ((), i), "dE": ((), f),
            "pain": ((), f), "surprise": ((), f), "prev_energy": ((), f),
            "id": ((), np.int64), "parent": ((), np.int64), "gen": ((), i),
            "birth_t": ((), np.int64), "tag": ((), i), "frozen": ((), b),
            "children": ((), i), "genome": ((lay.L,), f), "germ": ((lay.L,), f),
            "has_germ": ((), b),
            "size": ((), f), "max_age": ((), f), "repro_thr": ((), f),
            "invest": ((), f), "eff": ((cfg.K_max + 1,), f), "color": ((3,), f),
            "compat": ((), f), "eta_pred": ((), f), "temp": ((), f),
            "epi_rho": ((), f), "share": ((), f),
            "arc_eta": ((), f), "arc_dE": ((), f), "arc_mod": ((), f), "arc_trace": ((), f),
            "sal_eta": ((), f), "sal_dE": ((), f), "sal_decay": ((), f),
            "sal_F": ((vision_channels(cfg),), f),   # learned salience offsets
            "sal_e": ((vision_channels(cfg),), f),   # eligibility: what was recently eaten
            "sal_base": ((), f),                     # running mean of energy change
            "xm_eta": ((), f), "call_gain": ((cfg.S_max,), f), "m_val": ((), f),
            "s_prev": ((cfg.S_max,), f),                     # own last emission (corollary discharge)
            "xm_W": ((vision_channels(cfg), cfg.S_max), f),  # heard sound -> salience
            "xm_e": ((vision_channels(cfg), cfg.S_max), f),  # its eligibility
        }
        spec.update(brain_spec(cfg))
        self.spec = spec
        self.A = cfg.max_agents
        self.arr = {k: xp.zeros((self.A,) + s, dtype=d) for k, (s, d) in spec.items()}
        self.n = 0

    def __getitem__(self, k):
        return self.arr[k]

    def remove(self, xp, dead):
        n = self.n
        nd = int(dead.sum())
        if nd == 0:
            return
        n_new = n - nd
        holes = xp.nonzero(dead[:n_new])[0]
        movers = xp.nonzero(~dead[n_new:n])[0] + n_new
        if holes.size:
            for a in self.arr.values():
                a[holes] = a[movers]
        self.n = n_new

    def append(self, rows: dict) -> int:
        b = int(rows["genome"].shape[0])
        b = min(b, self.A - self.n)
        if b <= 0:
            return 0
        n = self.n
        for k, a in self.arr.items():
            if k in rows:
                a[n:n + b] = rows[k][:b]
            else:
                a[n:n + b] = 0
        self.n = n + b
        return b


class World:
    def __init__(self, cfg: Config, physics: Physics | None = None,
                 populate: bool = True):
        self.cfg = cfg
        xp = self.xp = get_xp(cfg.device)
        self.lay = GenomeLayout(cfg)
        self.rng = xp.random.default_rng(cfg.seed)            # behaviour (fixed-shape draws)
        self.rng_dev = xp.random.default_rng(cfg.seed + 7919)  # development + mutation
        self.hrng = np.random.default_rng(cfg.seed + 104729)   # host: climate, hotspots
        self.rng_occ = xp.random.default_rng(cfg.seed + 31337)  # occlusion (separate stream)
        self.physics = physics or Physics(cfg.k_init, cfg.s_init, cfg.p_init,
                                          cfg.building_init, cfg.night_radius_init)
        H, W, K = cfg.H, cfg.W, cfg.K_max
        f32 = np.float32
        self.t = 0
        self.veg = xp.zeros((K, H, W), f32)
        self.cache = xp.zeros((K, H, W), f32)
        self.meat = xp.zeros((H, W), f32)
        self.wall = xp.zeros((H, W), f32)
        self.pher = xp.zeros((cfg.P_max, H, W), f32)
        self.sound = xp.zeros((cfg.S_max, H, W), f32)       # what is heard this step
        self.sound_emit = xp.zeros((cfg.S_max, H, W), f32)  # what is said this step
        self.fert = xp.zeros((K, H, W), f32)
        self.species_value = xp.ones(K, f32)
        self.species_rate = np.ones(K, f32)
        self.force_day = False
        self.plastic_on = True       # assays can knock plasticity out
        self.hook = None             # probe(world, n, Ne, Xv, Xo, h_new, out) before physics
        self.lesion = None           # None | "vision" | "sound" | "memory"
        self.policy = None           # oracle strategy f(world, n, Xv) -> actions, replaces brains
        self.Ne = 1
        self.hot = self.hrng.uniform(0, 1, (K, cfg.n_hotspots, 2)) * np.array([H, W])
        self.hot_dir = self.hrng.uniform(0, 2 * np.pi, (K, cfg.n_hotspots))
        self.climate = np.array([1.0, 1.0, 20.0])
        sites = (self.hrng.random((H, W)) < cfg.site_density).astype(np.float32)
        # two-tier vegetation: low-yield grass everywhere, rich fruit at fixed sites
        self.cap = xp.asarray(cfg.grass_cap + (getattr(cfg, "fruit_cap", 1.0) - cfg.grass_cap) * sites)
        L = getattr(cfg, "species_patch", 0.0)
        if L > 0:   # patchy plant communities: one species per cell, active species only
            noise = self.hrng.standard_normal((cfg.K_max, H, W))
            fy = np.fft.fftfreq(H)[:, None]
            fx = np.fft.fftfreq(W)[None, :]
            kern = np.exp(-2 * (np.pi * L) ** 2 * (fy ** 2 + fx ** 2))
            smooth = np.real(np.fft.ifft2(np.fft.fft2(noise) * kern))
            self._species_noise = smooth
            self.species_map = None
        else:
            self._species_noise = None
        yy, xx = np.meshgrid(np.arange(H), np.arange(W), indexing="ij")
        self._yy, self._xx = xp.asarray(yy, f32), xp.asarray(xx, f32)
        self.light = xp.ones((H, 1), f32)
        self.is_night = False
        self._build_geometry()
        self._update_drivers(force_fert=True)
        self.veg[:self.physics.k_active] = 0.5 * self.fert[:self.physics.k_active] * self.cap
        if self._species_noise is not None:
            owner = self._species_noise[:self.physics.k_active].argmax(0)
            self.veg[:self.physics.k_active] *= xp.asarray(
                np.stack([(owner == j) for j in range(self.physics.k_active)]).astype(np.float32))
        self.agents = Agents(cfg, self.lay, xp)
        self.next_id = 0
        self.ledger = dict(solar=0.0, heat=0.0, immigration=0.0)
        self.counters = defaultdict(float)
        self.action_hist = np.zeros(NA, np.int64)
        self.fossils: list[tuple[int, np.ndarray]] = []
        self.events: list[tuple[int, str]] = []
        self.refresh_masks()
        self._fields = xp.zeros((vision_channels(cfg), H, W), f32)
        self._buf = xp.zeros((cfg.max_agents, cfg.N, cfg.N), f32)
        self.last_eat = xp.zeros((0, K + 1), f32)
        if populate:
            self.spawn(self.random_genomes(cfg.init_agents), energy=3.0)
        self.E0 = self.total_energy()

    # ------------------------------------------------------------------ setup
    def _build_geometry(self):
        xp = self.xp
        off = np.zeros((4, len(PATCH), 2), np.int32)
        for h in range(4):
            for p, (f, s) in enumerate(PATCH):
                off[h, p] = f * F_DIR[h] + s * R_DIR[h]
        snd = np.zeros((4, len(SOUND_PTS), 2), np.int32)
        for h in range(4):
            for p, (f, s) in enumerate(SOUND_PTS):
                snd[h, p] = f * F_DIR[h] + s * R_DIR[h]
        cheb = np.array([max(abs(f), abs(s)) for f, s in PATCH])
        self.offsets = xp.asarray(off)
        self.sound_offsets = xp.asarray(snd)
        self.near_mask = xp.asarray((cheb <= 1).astype(np.float32))
        self._pf = xp.asarray(np.array([f for f, s in PATCH], np.float32))
        self._ps = xp.asarray(np.array([s for f, s in PATCH], np.float32))
        self.night_masks = [xp.asarray((cheb <= r).astype(np.float32)) for r in range(3)]
        self.F_dir = xp.asarray(F_DIR)
        self.eyeNA = xp.eye(NA, dtype=np.float32)

    def refresh_masks(self):
        self.mutable = self.lay.mutable_mask(self.physics)
        self.mutable_xp = self.xp.asarray(self.mutable)

    def random_genomes(self, n):
        return random_genomes(self.xp, self.rng_dev, self.lay, n, self.mutable)

    def unfold(self):
        from .unfolding import unfold
        what = unfold(self.physics, self.cfg)
        if what:
            self.refresh_masks()
            self.events.append((self.t, "unfold:" + what))
        return what

    # ---------------------------------------------------------------- drivers
    def _update_drivers(self, force_fert=False):
        cfg, xp = self.cfg, self.xp
        H = cfg.H
        if cfg.climate:
            x, y, z = self.climate
            dt = cfg.climate_dt
            self.climate = self.climate + dt * np.array(
                [10.0 * (y - x), x * (28.0 - z) - y, x * y - 8.0 / 3.0 * z])
            x, y, z = self.climate
            amp_c = 0.5 + 0.5 * np.clip((z - 5.0) / 40.0, 0.0, 1.0)
            season = math.sin(2 * math.pi * self.t / cfg.season_period)
            lat = (np.ones(H) if getattr(cfg, "season_global", False)
                   else np.cos(2 * np.pi * (np.arange(H) + 0.5) / H))
            light = np.clip(0.55 + cfg.season_amp * amp_c * season * lat, 0.05, 1.0)
            self.light = xp.asarray(light.astype(np.float32))[:, None]
            self.is_night = (not self.force_day) and \
                math.sin(2 * math.pi * self.t / cfg.day_period) < -0.5
            phase = math.pi * x / 20.0
            k = np.arange(cfg.K_max)
            self.species_rate = (1.0 + 0.6 * np.sin(phase + 2 * np.pi * k / cfg.K_max)).astype(np.float32)
            self.hot_dir += 0.002 * y / 20.0 + 0.01 * self.hrng.standard_normal(self.hot_dir.shape)
            step = cfg.hotspot_speed * np.stack([np.cos(self.hot_dir), np.sin(self.hot_dir)], -1)
            self.hot = (self.hot + step) % np.array([cfg.H, cfg.W])
        else:
            self.is_night = False
        P = getattr(cfg, "tox_period", 0)
        if P > 0:   # which species is nutritious right now (opposite phases for 2 species)
            k = np.arange(cfg.K_max)
            good = np.sin(2 * math.pi * self.t / P + math.pi * k) > 0
            ramp = getattr(cfg, "tox_ramp", 0)
            r = float(np.clip((self.t - getattr(cfg, "tox_start", 0)) / max(ramp, 1), 0.0, 1.0)) \
                if (ramp or getattr(cfg, "tox_start", 0)) else 1.0
            bad = 1.0 - (1.0 + cfg.tox_value) * r
            self.species_value = xp.asarray(np.where(good, 1.0, bad).astype(np.float32))
        if force_fert or (cfg.climate and self.t % 10 == 0):
            K, nh = self.hot.shape[:2]
            hy = xp.asarray(self.hot[..., 0].astype(np.float32))[:, :, None, None]
            hx = xp.asarray(self.hot[..., 1].astype(np.float32))[:, :, None, None]
            dy = xp.abs(self._yy[None, None] - hy)
            dx = xp.abs(self._xx[None, None] - hx)
            dy = xp.minimum(dy, cfg.H - dy)
            dx = xp.minimum(dx, cfg.W - dx)
            s2 = (cfg.hotspot_sigma * min(cfg.H, cfg.W)) ** 2
            blob = xp.exp(-(dy * dy + dx * dx) / (2 * s2)).sum(1)
            self.fert = (cfg.fert_base + (1 - cfg.fert_base) * xp.clip(blob, 0, 1)).astype(np.float32)

    # --------------------------------------------------------------- spawning
    def occupancy(self):
        xp = self.xp
        occ = xp.full((self.cfg.H, self.cfg.W), -1, np.int32)
        n = self.agents.n
        if n:
            p = self.agents["pos"][:n]
            occ[p[:, 0], p[:, 1]] = xp.arange(n, dtype=np.int32)
        return occ

    def free_cells(self, k):
        xp, cfg = self.xp, self.cfg
        occ = self.occupancy()
        free = ((occ < 0) & (self.wall < 0.5)).reshape(-1)
        idx = xp.nonzero(free)[0]
        if idx.size == 0 or k == 0:
            return xp.zeros((0, 2), np.int32)
        pick = idx[xp.argsort(self.rng_dev.random(int(idx.size)))[:k]]
        return xp.stack([pick // cfg.W, pick % cfg.W], 1).astype(np.int32)

    def spawn(self, genomes, positions=None, headings=None, energy=3.0,
              immigration=False, tag=-1, parents=None, gens=None,
              F=None, P=None):
        xp, cfg = self.xp, self.cfg
        b = int(genomes.shape[0])
        b = min(b, self.agents.A - self.agents.n)
        if b <= 0:
            return 0
        genomes = genomes[:b]
        if positions is None:
            positions = self.free_cells(b)
            b = int(positions.shape[0])
            genomes = genomes[:b]
            if b == 0:
                return 0
        rows = decode_globals(xp, self.lay, genomes, self.physics.k_active)
        rows.update(develop(xp, self.rng_dev, self.lay, genomes, self.physics))
        en = xp.full(b, energy, np.float32) if np.isscalar(energy) else energy[:b]
        if getattr(cfg, "energy_cap", 0.0) > 0:
            en = xp.minimum(en, cfg.energy_cap * rows["size"]).astype(np.float32)
        rows.update(
            genome=genomes, pos=positions[:b],
            heading=(self.rng_dev.integers(0, 4, b).astype(np.int32)
                     if headings is None else headings[:b]),
            energy=en, prev_energy=en, health=xp.ones(b, np.float32),
            structure=rows["size"] * cfg.struct_cost,
            id=xp.arange(self.next_id, self.next_id + b, dtype=np.int64),
            parent=(xp.full(b, -1, np.int64) if parents is None else parents[:b]),
            gen=(xp.zeros(b, np.int32) if gens is None else gens[:b]),
            birth_t=xp.full(b, self.t, np.int64), tag=xp.full(b, tag, np.int32),
            last_action=xp.zeros(b, np.int32),
        )
        if F is not None:
            rows["F"] = F[:b]
        if P is not None:
            rows["P"] = P[:b]
        b = self.agents.append(rows)
        self.next_id += b
        if immigration:
            self.ledger["immigration"] += fsum(en[:b]) + fsum(rows["structure"][:b])
        return b

    # ----------------------------------------------------------------- sense
    def _sense(self, occ, noise):
        xp, cfg, A = self.xp, self.cfg, self.agents
        n, K, H, W = A.n, cfg.K_max, cfg.H, cfg.W
        pos, hd = A["pos"][:n], A["heading"][:n]
        Fd = self._fields
        Fd[:K] = self.veg
        Fd[K] = self.meat
        Fd[K + 1] = self.cache.sum(0)
        Fd[K + 2] = (occ >= 0)
        Fd[K + 3:K + 6] = 0
        Fd[K + 3:K + 6, pos[:, 0], pos[:, 1]] = A["color"][:n].T
        Fd[K + 6] = self.wall
        Fd[K + 7:] = self.pher
        off = self.offsets[hd]
        iy = (pos[:, 0:1] + off[:, :, 0]) % H
        ix = (pos[:, 1:2] + off[:, :, 1]) % W
        Xv = xp.ascontiguousarray(Fd[:, iy, ix].transpose(1, 0, 2))  # (n, C, P)
        if getattr(cfg, "sensor_mode", "linear") == "weber":   # food receptors: veg, meat, cache
            x0 = cfg.weber_x0
            Xv[:, :K + 2] = xp.log1p(Xv[:, :K + 2] / x0) / math.log1p(1.0 / x0)
        Xv[:, K + 1, :] *= self.near_mask
        vis = getattr(cfg, "food_visibility", 1.0)
        if vis < 1.0:   # occlusion: food flickers in and out of view; underfoot is always felt
            seen = (self.rng_occ.random((self.agents.A, Xv.shape[2]), dtype=np.float32) < vis)[:n]
            seen[:, CENTER_P] = True
            Xv[:, :K + 2, :] *= seen[:, None, :]
        if self.is_night:
            Xv *= self.night_masks[self.physics.night_radius]
        so = self.sound_offsets[hd]
        sy = (pos[:, 0:1] + so[:, :, 0]) % H
        sx = (pos[:, 1:2] + so[:, :, 1]) % W
        snd = self.sound[:, sy, sx].transpose(1, 2, 0).reshape(n, -1)  # (n, 5*S)
        if getattr(cfg, "corollary_discharge", False):
            # own emission sits on own cell, so it reaches all 5 sampling points (blur radius 2)
            snd = snd - xp.tile(self.agents["s_prev"][:n], (1, N_SOUND_PTS_W))
        light = self.light[pos[:, 0], 0]
        energy = A["energy"][:n]
        carry = A["carry"][:n].sum(1)
        dE = xp.clip(A["dE"][:n] * 5.0, -2.0, 2.0)
        pain = A["pain"][:n]
        intero6 = xp.stack([energy / 5.0, A["health"][:n], dE, pain, carry, light], 1)
        mean3 = (Xv * self.near_mask).sum(-1) / 9.0
        target = xp.concatenate([mean3, Xv[:, :, FRONT_P], intero6, snd[:, :cfg.S_max]], 1)
        return Xv, snd, intero6, target

    def _salience_learning(self, n):
        """Value learning on the tectal salience map (conditioned taste preference /
        aversion). The energy change now reflects what was eaten last step:
            m      = tanh(g_dE * (dE - baseline))     evolved value signal (RPE)
            sal_F += eta * m * e - decay * sal_F       credit to what was eaten
        and the eligibility e (channels of eaten cells) is extended after acting."""
        xp, A = self.xp, self.agents
        dE = A["dE"][:n]
        base = A["sal_base"][:n]
        rpe = dE - base
        base += 0.05 * rpe
        m = xp.tanh(A["sal_dE"][:n] * rpe * 10.0)
        F = A["sal_F"][:n]
        F += (A["sal_eta"][:n] * m)[:, None] * A["sal_e"][:n] - A["sal_decay"][:n, None] * F
        xp.clip(F, -4.0, 4.0, out=F)
        A["m_val"][:n] = m
        if getattr(self.cfg, "cross_modal", False):
            # cross-modal association: "when I heard s and ate c, it was good/bad"
            X = A["xm_W"][:n]
            X += (A["xm_eta"][:n] * m)[:, None, None] * A["xm_e"][:n] \
                - A["sal_decay"][:n, None, None] * X
            xp.clip(X, -4.0, 4.0, out=X)
        self.counters["sal_m_abs"] += fsum(xp.abs(m))

    def _salience_trace(self, n, Xv, act):
        A, xp = self.agents, self.xp
        e = A["sal_e"][:n]
        e *= 0.5
        ate = (act == EAT).astype(np.float32)
        K = self.cfg.K_max          # taste senses the food (species, meat, cache), not the eater
        e[:, :K + 2] += ate[:, None] * Xv[:, :K + 2, CENTER_P]
        if getattr(self.cfg, "cross_modal", False):
            x = A["xm_e"][:n]
            x *= 0.5
            x[:, :K + 2, :] += (ate[:, None] * Xv[:, :K + 2, CENTER_P])[:, :, None] \
                * self._heard[:, None, :]

    def _tectum(self, Xv, n):
        """Optic-tectum analogue: a retinotopic salience map (genetically weighted
        sum of visual channels at each location) with soft winner-take-all over
        the surround. Outputs the attended egocentric location (f*, s*), its
        salience, the salience underfoot, and their difference."""
        xp, A = self.xp, self.agents
        w = A["genome"][:n, self.lay.gs["sal_w"]]                     # (n, C)
        if getattr(self.cfg, "sal_learning", False) and self.plastic_on:
            w = w + A["sal_F"][:n]
            if getattr(self.cfg, "cross_modal", False):   # what I hear changes what is salient
                w = w + xp.matmul(A["xm_W"][:n], self._heard[:, :, None])[:, :, 0]
        beta = xp.exp(xp.clip(A["genome"][:n, self.lay.gs["sal_beta"].start], -2.0, 3.0))
        sal = (Xv * w[:, :, None]).sum(1)                              # (n, P)
        own = sal[:, CENTER_P]
        z = beta[:, None] * sal
        z[:, CENTER_P] = -1e9
        z = z - z.max(1, keepdims=True)
        att = xp.exp(z)
        att /= att.sum(1, keepdims=True)
        fs, ss = self._pf, self._ps
        f_att = (att * fs).sum(1) / 2.0
        s_att = (att * ss).sum(1) / 2.0
        m = (att * sal).sum(1)
        self.last_attention = att
        return xp.stack([f_att, s_att, m, own, m - own], 1).astype(np.float32)

    # ------------------------------------------------------------------ step
    def step(self, record: bool = False):
        xp, cfg, A = self.xp, self.cfg, self.agents
        H, W, K = cfg.H, cfg.W, cfg.K_max
        f32 = np.float32
        self.t += 1
        Amax = A.A
        u_g = self.rng.random((Amax, NA), dtype=f32)
        u_m = self.rng.random(Amax, dtype=f32)
        u_d = self.rng.random((Amax, 4), dtype=f32)
        nz = self.rng.standard_normal(Amax, dtype=f32)
        self._update_drivers()
        rec = None
        heat = 0.0
        births = None
        n = A.n
        if n > 0:
            Ne = max(1, int(A["n_neurons"][:n].max()))
            self.Ne = Ne
            occ = self.occupancy()
            Xv, snd, intero6, target = self._sense(occ, nz)
            # predictive substrate: error of last step's prediction
            surprise = forward_model_update(xp, A.arr, n, Ne, A["eta_pred"][:n], target)
            A["surprise"][:n] = surprise
            age_f = A["age"][:n].astype(f32) / A["max_age"][:n]
            intero = xp.concatenate([
                intero6[:, 0:2], age_f[:, None], intero6[:, 2:5], intero6[:, 5:6],
                surprise[:, None], xp.ones((n, 1), f32), 0.5 * nz[:n, None], A["color"][:n]], 1)
            Xo = xp.concatenate([snd, intero, self.eyeNA[A["last_action"][:n]]], 1)
            deaf = getattr(self, "lesion", None) == "sound"
            self._heard = (xp.zeros((n, cfg.S_max), f32) if deaf
                           else snd.reshape(n, 5, cfg.S_max).sum(1))   # what is heard, any direction
            if getattr(cfg, "sal_learning", False) and self.plastic_on:
                self._salience_learning(n)
            if getattr(cfg, "tectum", False):
                Xo = xp.concatenate([Xo, self._tectum(Xv, n)], 1)
            policy = getattr(self, "policy", None)  # oracle strategies (oracles.py)
            if policy is not None and getattr(policy, "needs_brain", False):
                self._brain_act = None               # brains run; policy may override some
            if policy is None or getattr(policy, "needs_brain", False):
                les = getattr(self, "lesion", None)      # lesion studies (metrics.lesion_study)
                if les == "vision":
                    Xv = xp.zeros_like(Xv)
                    if getattr(cfg, "tectum", False):   # blindness silences the tectum too
                        Xo[:, -5:] = 0
                elif les == "sound":
                    Xo[:, :5 * cfg.S_max] = 0
                elif les == "memory":                    # reflex-only: no carried-over state
                    A["h"][:n] = 0
                    A["F"][:n] = 0
                    A["alpha"][:n] = 1.0
                h_prev = A["h"][:n, :Ne].copy()
                aux = {} if getattr(cfg, "arc_learning", False) else None
                h_new, out = brain_forward(xp, A.arr, n, Ne, Xv, Xo, self.plastic_on,
                                           getattr(cfg, "bilateral", False),
                                           getattr(cfg, "reflex_arcs", False), aux,
                                           getattr(cfg, "arc_features", "rf"))
                S, P_ = cfg.S_max, cfg.P_max
                if self.hook is not None:
                    self.hook(self, n, Ne, Xv, Xo, h_new, out)
                mod = xp.tanh(out[:, NA + S + P_:])
                if self.plastic_on:
                    plasticity(xp, A.arr, n, Ne, h_prev, h_new, mod, cfg.F_clip, self._buf)
                A["h"][:n, :Ne] = h_new
                A["pred"][:n] = forward_model_predict(xp, A.arr, n, Ne)

                # ---- decode outputs
                om = A["omask"][:n]          # repertoire is fixed at development, so an
                logits = out[:, :NA] / A["temp"][:n, None] + (om[:, :NA] - 1.0) * 1e9
                if not self.physics.building:    # unfolding never changes living organisms
                    logits[:, BUILD] = -1e9
                if "tec_arc" in self.lay.gs:         # tectal reflex arcs (direct orienting/feeding)
                    tec = Xo[:, -5:]
                    Wt = A["genome"][:n, self.lay.gs["tec_arc"]].reshape(n, 5, NA)
                    d = xp.matmul(tec[:, None, :], Wt)[:, 0, :]
                    if getattr(cfg, "bilateral", False):   # mirror: s* -> -s*, left <-> right
                        tm = tec.copy()
                        tm[:, 1] = -tm[:, 1]
                        dm = xp.matmul(tm[:, None, :], Wt)[:, 0, :]
                        dm[:, [LEFT, RIGHT]] = dm[:, [RIGHT, LEFT]]
                        d = 0.5 * (d + dm)
                    logits = logits + d * om[:, :NA] / A["temp"][:n, None]
                gumbel = -xp.log(-xp.log(u_g[:n] + 1e-12) + 1e-12)
                act = xp.argmax(logits + gumbel, 1).astype(np.int32)
                if aux is not None and self.plastic_on and "s" in aux:
                    m_arc = arc_learning_step(
                        xp, A.arr, n, aux["s"], aux.get("sm"), logits, act, mod[:, 0],
                        A["dE"][:n], (A["arc_eta"][:n], A["arc_dE"][:n], A["arc_mod"][:n],
                                      A["arc_trace"][:n]), getattr(cfg, "arc_rpe", True))
                    self.counters["arc_m_abs"] += fsum(xp.abs(m_arc))
                frozen = A["frozen"][:n]
                act = xp.where(frozen, NOOP, act).astype(np.int32)
                s_emit = xp.tanh(out[:, NA:NA + S]) * om[:, NA:NA + S]
                if getattr(cfg, "vocal_value", False) and getattr(cfg, "sal_learning", False):
                    # value-coupled vocalisation (food / disgust calls), gain is genetic
                    s_emit = xp.clip(s_emit + A["call_gain"][:n] * A["m_val"][:n, None], -1.0, 1.0)
                if getattr(self, "mute_tag", None) is not None:   # experiment: silence a group
                    s_emit = s_emit * (A["tag"][:n] != self.mute_tag)[:, None]
                A["s_prev"][:n] = s_emit
                s_emit[:, self.physics.s_active:] = 0
                p_emit = om[:, NA + S:NA + S + P_] / (1.0 + xp.exp(-(out[:, NA + S:NA + S + P_] - 2.0)))
                p_emit[:, self.physics.p_active:] = 0
                if policy is not None:               # mixed: -1 = let the brain decide
                    pa = policy(self, n, Xv).astype(np.int32)
                    act = xp.where(pa >= 0, pa, act).astype(np.int32)
                    act = xp.where(A["frozen"][:n], NOOP, act).astype(np.int32)
            else:                                    # scripted: no brain, no emissions
                S, P_ = cfg.S_max, cfg.P_max
                act = policy(self, n, Xv).astype(np.int32)
                act = xp.where(A["frozen"][:n], NOOP, act).astype(np.int32)
                h_new = xp.zeros((n, Ne), f32)
                out = xp.zeros((n, NA + S + P_ + cfg.M_mod), f32)
                s_emit = xp.zeros((n, S), f32)
                p_emit = xp.zeros((n, P_), f32)
            if record:
                rec = dict(Xv=Xv, Xo=Xo, h=h_new, out=out, act=act, m_val=A["m_val"][:n].copy(),
                           s_emit=s_emit, pos=A["pos"][:n].copy(),
                           heading=A["heading"][:n].copy(),
                           ids=A["id"][:n].copy(), energy=A["energy"][:n].copy())
            if getattr(cfg, "sal_learning", False) and self.plastic_on:
                self._salience_trace(n, Xv, act)
            A["last_action"][:n] = act
            self.action_hist += np.bincount(to_numpy(act), minlength=NA)
            heat += self._act(act, u_m, u_d, s_emit, p_emit, occ, h_new)
            births = self._reproduce(act, u_m, u_d)
            heat += self._metabolism(s_emit, p_emit, h_new)
            heat += self._deaths()
        if births is not None:
            nb = self.agents.append(births)
            self.next_id += nb
            self.counters["births"] += nb
        heat += self._fields_update()
        self.ledger["heat"] += heat
        if cfg.immigration and self.agents.n < cfg.min_agents:
            self._immigrate(cfg.min_agents - self.agents.n)
        if self.t % 250 == 0 and self.agents.n:
            self._fossilize()
        return rec

    # ---------------------------------------------------------------- actions
    def _act(self, act, u_m, u_d, s_emit, p_emit, occ, h_new):
        xp, cfg, A = self.xp, self.cfg, self.agents
        H, W, K, n = cfg.H, cfg.W, cfg.K_max, A.n
        pos, hd = A["pos"][:n], A["heading"][:n]
        size, energy = A["size"][:n], A["energy"][:n]
        heat = 0.0
        # turning
        hd[:] = (hd + (act == RIGHT).astype(np.int32) - (act == LEFT).astype(np.int32)) % 4
        # moving (one body per cell; contested cells go to a random claimant)
        self._moved = xp.zeros(n, bool)
        idx = xp.nonzero(act == FWD)[0]
        if idx.size:
            d = self.F_dir[hd[idx]]
            ty = (pos[idx, 0] + d[:, 0]) % H
            tx = (pos[idx, 1] + d[:, 1]) % W
            ok = (occ[ty, tx] < 0) & (self.wall[ty, tx] < 0.5)
            idx, ty, tx = idx[ok], ty[ok], tx[ok]
            if idx.size:
                order = xp.argsort(u_m[idx])
                lin = (ty * W + tx)[order]
                _, first = xp.unique(lin, return_index=True)
                win = order[first]
                pos[idx[win], 0] = ty[win]
                pos[idx[win], 1] = tx[win]
                self._moved[idx[win]] = True
                self.counters["moves"] += int(win.size)
        occ = self.occupancy()
        fd = self.F_dir[hd]
        fy = (pos[:, 0] + fd[:, 0]) % H
        fx = (pos[:, 1] + fd[:, 1]) % W
        front = occ[fy, fx]
        self._front, self._occ = front, occ
        self.last_eat = xp.zeros((n, K + 1), np.float32)

        # eating (vegetation, caches, meat; then carried food if the cell is bare)
        e = xp.nonzero(act == EAT)[0]
        if e.size:
            ey, ex = pos[e, 0], pos[e, 1]
            bite = cfg.bite * (0.5 + 0.5 * size[e])
            vh = self.veg[:, ey, ex]
            tv = xp.minimum(vh, bite[None, :])
            ch = self.cache[:, ey, ex]
            tc = xp.minimum(ch, xp.maximum(bite[None, :] - tv, 0))
            mh = self.meat[ey, ex]
            tm = xp.minimum(mh, bite)
            self.veg[:, ey, ex] = vh - tv
            self.cache[:, ey, ex] = ch - tc
            self.meat[ey, ex] = mh - tm
            food = (tv + tc).T                                     # (m, K)
            car = A["carry"][e]
            bare = (food.sum(1) + tm) < 0.02
            tcar = xp.where(bare[:, None], xp.minimum(car, bite[:, None]), 0.0)
            A["carry"][e] = car - tcar
            food = food + tcar
            eff = A["eff"][e]
            gain = (eff[:, :K] * self.species_value[None, :] * food).sum(1) + eff[:, K] * tm
            consumed = food.sum(1) + tm
            heat += fsum(consumed - gain)
            energy[e] += gain
            self.last_eat[e, :K] = food
            self.last_eat[e, K] = tm
            self.counters["eat_gain"] += fsum(gain)

        # picking up food into the carried inventory
        pk = xp.nonzero(act == PICK)[0]
        if pk.size:
            py, px = pos[pk, 0], pos[pk, 1]
            space = xp.maximum(cfg.carry_cap * size[pk] - A["carry"][pk].sum(1), 0)
            vh, ch = self.veg[:, py, px], self.cache[:, py, px]
            avail = vh + ch
            tot = avail.sum(0)
            take_tot = xp.minimum(xp.minimum(space, cfg.pick_amount), tot)
            take = avail / xp.maximum(tot, 1e-9) * take_tot
            tc = xp.minimum(ch, take)
            tv = xp.minimum(vh, take - tc)
            self.cache[:, py, px] = ch - tc
            self.veg[:, py, px] = vh - tv
            A["carry"][pk] += (tc + tv).T
            self.counters["picks"] += fsum(take_tot)

        # dropping carried food -> a cache (persistent, hidden beyond range 1)
        dp = xp.nonzero((act == DROP) & (A["carry"][:n].sum(1) > 0))[0]
        if dp.size:
            self.cache[:, pos[dp, 0], pos[dp, 1]] += A["carry"][dp].T
            self.counters["cached"] += fsum(A["carry"][dp])
            A["carry"][dp] = 0

        # attacking the body or wall in front
        self._attack_cost = xp.zeros(n, np.float32)
        self._dmg = xp.zeros(n, np.float32)
        at = xp.nonzero(act == ATTACK)[0]
        if at.size:
            self._attack_cost[at] = cfg.c_attack * size[at]
            v = front[at]
            has = v >= 0
            if bool(has.any()):
                a_i, v_i = at[has], v[has]
                dmg = cfg.attack_power * size[a_i] / size[v_i]
                self._dmg = scatter_add(xp, n, v_i, dmg)
                A["health"][:n] -= self._dmg
                self.counters["hits"] += int(a_i.size)
            wa = at[~has]
            if wa.size:
                lin = fy[wa] * W + fx[wa]
                red = scatter_add(xp, H * W, lin, xp.full(wa.size, 0.34, np.float32))
                wf = self.wall.reshape(-1)
                dec = xp.minimum(wf, red)
                wf -= dec
                heat += cfg.c_build * fsum(dec)

        # sharing energy with the body in front
        sh = xp.nonzero((act == SHARE) & (front >= 0))[0]
        if sh.size:
            amt = A["share"][sh]
            ok = energy[sh] > cfg.share_min_energy + amt
            sh, amt = sh[ok], amt[ok]
            if sh.size:
                energy[sh] -= amt
                energy += scatter_add(xp, n, front[sh], amt)
                self.counters["shared"] += fsum(amt)

        # building a wall in the empty cell in front
        if self.physics.building:
            bd = xp.nonzero((act == BUILD) & (front < 0) & (energy > cfg.c_build + 0.3))[0]
            if bd.size:
                by, bx = fy[bd], fx[bd]
                ok = self.wall[by, bx] < 0.5
                bd, by, bx = bd[ok], by[ok], bx[ok]
                if bd.size:
                    lin = by * W + bx
                    _, first = xp.unique(lin, return_index=True)
                    bd, by, bx = bd[first], by[first], bx[first]
                    cost = (1.0 - self.wall[by, bx]) * cfg.c_build
                    self.wall[by, bx] = 1.0
                    energy[bd] -= cost
                    self.counters["built"] += int(bd.size)

        # emissions: pheromone (persistent) and sound (next step only)
        self.pher[:, pos[:, 0], pos[:, 1]] += p_emit.T
        self.sound_emit[:, pos[:, 0], pos[:, 1]] = s_emit.T
        self.counters["sound_power"] += fsum((s_emit ** 2).sum(1))
        return heat

    # ----------------------------------------------------------- reproduction
    def _reproduce(self, act, u_m, u_d):
        xp, cfg, A = self.xp, self.cfg, self.agents
        if not cfg.repro:
            return None
        H, W, n = cfg.H, cfg.W, A.n
        energy = A["energy"][:n]
        wants = (act == REPRO) | bool(getattr(cfg, "auto_repro", False))
        cand = wants & (A["age"][:n] >= cfg.min_repro_age) & \
               (energy >= A["repro_thr"][:n]) & ~A["frozen"][:n]
        ci = xp.nonzero(cand)[0]
        if ci.size == 0:
            return None
        occ = self._occ
        pos = A["pos"][:n]
        dirs = xp.argsort(u_d[ci], axis=1)
        dvec = self.F_dir[dirs]                                     # (m, 4, 2)
        cy = (pos[ci, 0:1] + dvec[:, :, 0]) % H
        cx = (pos[ci, 1:2] + dvec[:, :, 1]) % W
        free = (occ[cy, cx] < 0) & (self.wall[cy, cx] < 0.5)
        has = free.any(1)
        first = xp.argmax(free, 1)
        r = xp.arange(ci.size)
        by, bx = cy[r, first], cx[r, first]
        ci, by, bx = ci[has], by[has], bx[has]
        if ci.size == 0:
            return None
        order = xp.argsort(u_m[ci])
        lin = (by * W + bx)[order]
        _, fi = xp.unique(lin, return_index=True)
        keep = order[fi]
        ci, by, bx = ci[keep], by[keep], bx[keep]
        room = A.A - n
        ci, by, bx = ci[:room], by[:room], bx[:room]
        if ci.size == 0:
            return None
        g_par = A["genome"][ci]
        child = g_par.copy()
        partner = self._front[ci]
        pidx = xp.maximum(partner, 0)
        sexual = (partner >= 0) & (act[pidx] == REPRO) & (act[ci] == REPRO)
        if bool(sexual.any()):
            close = genome_distance(xp, g_par, A["genome"][pidx]) < A["compat"][ci]
            sexual &= close
        si = xp.nonzero(sexual)[0]
        if si.size:
            child[si] = crossover(xp, self.rng_dev, self.lay, g_par[si], A["genome"][pidx[si]])
        hg = A["has_germ"][ci]
        mi = xp.nonzero(~hg)[0]
        if mi.size:
            child[mi] = mutate(xp, self.rng_dev, self.lay, child[mi], self.mutable)
        gi = xp.nonzero(hg)[0]
        if gi.size:
            child[gi] = A["germ"][ci[gi]]
            A["has_germ"][ci[gi]] = False
            self.counters["germ_births"] += int(gi.size)
        ph = decode_globals(xp, self.lay, child, self.physics.k_active)
        struct = ph["size"] * cfg.struct_cost
        e_par = energy[ci]
        invest = A["invest"][ci] * e_par
        invest = xp.minimum(invest, e_par - 0.05 - struct - cfg.birth_overhead)
        if getattr(cfg, "energy_cap", 0.0) > 0:      # a child cannot hold more than its capacity
            invest = xp.minimum(invest, cfg.energy_cap * ph["size"])
        ok = invest >= 0.2
        if not bool(ok.any()):
            return None
        sel = xp.nonzero(ok)[0]
        ci, by, bx, child, invest, struct = ci[sel], by[sel], bx[sel], child[sel], invest[sel], struct[sel]
        energy[ci] -= invest + struct + cfg.birth_overhead
        self.ledger["heat"] += cfg.birth_overhead * int(ci.size)
        A["children"][ci] += 1
        rows = {k: v[sel] for k, v in ph.items()}
        rows.update(develop(xp, self.rng_dev, self.lay, child, self.physics))
        # epigenetic channel (evolvable strength rho): learned fast weights and
        # forward model pass to the child, matched neuron-by-neuron via (type, index)
        smap = inherit_slot_map(xp, self.lay, A["genome"][ci], child)
        rows["F"], rows["P"] = inherit_fast_weights(xp, A["F"][ci], A["P"][ci], smap,
                                                    A["epi_rho"][ci])
        rows["arc_F"] = A["arc_F"][ci] * A["epi_rho"][ci][:, None, None]   # retinotopic: slot-stable
        rows["sal_F"] = A["sal_F"][ci] * A["epi_rho"][ci][:, None]
        rows["xm_W"] = A["xm_W"][ci] * A["epi_rho"][ci][:, None, None]
        b = int(ci.size)
        rows.update(
            genome=child, pos=xp.stack([by, bx], 1).astype(np.int32),
            heading=A["heading"][ci].copy(), energy=invest, prev_energy=invest.copy(),
            health=xp.ones(b, np.float32), structure=struct,
            id=xp.arange(self.next_id, self.next_id + b, dtype=np.int64),
            parent=A["id"][ci].copy(), gen=A["gen"][ci] + 1,
            birth_t=xp.full(b, self.t, np.int64), tag=A["tag"][ci].copy(),
            last_action=xp.zeros(b, np.int32),
        )
        self.counters["births_sexual"] += int(sexual[sel].sum())
        return rows

    # -------------------------------------------------------------- metabolism
    def _metabolism(self, s_emit, p_emit, h_new):
        xp, cfg, A = self.xp, self.cfg, self.agents
        n = A.n
        size = A["size"][:n]
        cost = (cfg.c_basal * (0.5 + size)
                + cfg.c_neuron * A["n_neurons"][:n]
                + cfg.c_activity * xp.abs(h_new).sum(1)
                + cfg.c_wiring * A["wiring"][:n]
                + cfg.c_plastic * A["plast_sum"][:n]
                + cfg.c_forward * A["eta_pred"][:n] / 0.05
                + (getattr(cfg, "c_arc_learn", 0.0) * A["arc_eta"][:n] / 0.2
                   if getattr(cfg, "arc_learning", False) else 0.0)
                + (getattr(cfg, "c_sal_learn", 0.0) * A["sal_eta"][:n] / 0.5
                   if getattr(cfg, "sal_learning", False) else 0.0)
                + cfg.c_carry * A["carry"][:n].sum(1)
                + cfg.c_sound * (s_emit ** 2).sum(1)
                + cfg.c_pher * p_emit.sum(1)
                + cfg.c_move * size * self._moved
                + self._attack_cost)
        energy = A["energy"][:n]
        energy -= cost
        heat = fsum(cost)
        health = A["health"][:n]
        need = xp.clip(1.0 - health, 0, cfg.heal_rate)
        need = xp.where(energy > need + 0.1, need, 0.0)
        health += need
        energy -= need
        heat += fsum(need)
        cap = getattr(cfg, "energy_cap", 0.0)
        if cap > 0:            # limited fat storage: energy above capacity is lost as heat
            over = xp.maximum(energy - cap * size, 0.0)
            energy -= over
            heat += fsum(over)
        A["age"][:n] += 1
        A["dE"][:n] = energy - A["prev_energy"][:n]
        A["prev_energy"][:n] = energy
        A["pain"][:n] = xp.minimum(self._dmg * 4.0, cfg.pain_cap)
        self.counters["brain_cost"] += fsum(cfg.c_neuron * A["n_neurons"][:n]
                                            + cfg.c_activity * xp.abs(h_new).sum(1))
        self.counters["total_cost"] += heat
        return heat

    def _deaths(self):
        xp, cfg, A = self.xp, self.cfg, self.agents
        if not cfg.deaths:
            return 0.0
        n = A.n
        energy, health = A["energy"][:n], A["health"][:n]
        starve = energy <= 0
        killed = (health <= 0) & ~starve
        old = (A["age"][:n] >= A["max_age"][:n]) & ~starve & ~killed
        dead = starve | killed | old
        di = xp.nonzero(dead)[0]
        if di.size == 0:
            return 0.0
        e = energy[di]
        heat = fsum(xp.minimum(e, 0))   # an overdraft was booked as heat but never existed
        body = xp.maximum(e, 0) + A["structure"][di]
        y, x = A["pos"][di, 0], A["pos"][di, 1]
        self.meat[y, x] += body
        self.cache[:, y, x] += A["carry"][di].T
        self.counters["deaths_starved"] += int(starve.sum())
        self.counters["deaths_killed"] += int(killed.sum())
        self.counters["deaths_old"] += int(old.sum())
        self.counters["lifespan_sum"] += fsum(A["age"][di].astype(np.float32))
        self.counters["deaths"] += int(di.size)
        A.remove(xp, dead)
        return heat

    # ----------------------------------------------------------------- fields
    def _fields_update(self):
        xp, cfg = self.xp, self.cfg
        heat = 0.0
        k = self.physics.k_active
        if cfg.growth:
            v = self.veg[:k]
            rate = xp.asarray(self.species_rate[:k])[:, None, None]
            room = xp.maximum(1.0 - v / self.cap, 0.0)           # logistic to local cap
            if getattr(self, "_species_noise", None) is not None:
                sm = getattr(self, "species_map", None)
                if sm is None or sm.shape[0] != k:   # recomputed when a species unfolds
                    owner = self._species_noise[:k].argmax(0)
                    sm = xp.asarray(np.stack([(owner == j) for j in range(k)]).astype(np.float32))
                    self.species_map = sm
                room = room * sm
            dv = cfg.veg_rate * self.light[None] * rate * self.fert[:k] * \
                 (v + cfg.veg_seed) * room
            v += dv
            self.ledger["solar"] += fsum(dv)
            self.veg[:k] = _diffuse(xp, v, cfg.veg_diffuse)
        if cfg.cache_decay:
            heat += cfg.cache_decay * fsum(self.cache)
            self.cache *= (1 - cfg.cache_decay)
        if cfg.meat_decay:
            heat += cfg.meat_decay * fsum(self.meat)
            self.meat *= (1 - cfg.meat_decay)
        if cfg.wall_decay:
            heat += cfg.c_build * cfg.wall_decay * fsum(self.wall)
            self.wall *= (1 - cfg.wall_decay)
        self.pher = xp.minimum(_diffuse(xp, self.pher, cfg.pher_diffuse) * (1 - cfg.pher_decay), 4.0)
        self.sound = _box(xp, self.sound_emit, 2)
        self.sound_emit[:] = 0
        return heat

    # ------------------------------------------------------------ population
    def _immigrate(self, k):
        xp = self.xp
        na = int(k * self.cfg.immigrant_archive_frac) if self.fossils else 0
        parts = []
        if na:
            pool = np.concatenate([g for _, g in self.fossils[-20:]], 0)
            pick = self.hrng.integers(0, pool.shape[0], na)
            g = xp.asarray(pool[pick])
            parts.append(mutate(xp, self.rng_dev, self.lay, g, self.mutable))
        parts.append(self.random_genomes(k - na))
        got = self.spawn(xp.concatenate(parts, 0), energy=3.0, immigration=True)
        self.counters["immigrants"] += got

    def _fossilize(self, k=64):
        A = self.agents
        idx = self.hrng.permutation(A.n)[:k]
        self.fossils.append((self.t, to_numpy(A["genome"][:A.n][self.xp.asarray(idx)]).copy()))
        if len(self.fossils) > 200:
            self.fossils.pop(0)

    def redevelop(self, idx, genomes):
        """Replace the genome of living agents idx and regrow their brains
        (used by invasion screening; body state is kept)."""
        xp, A = self.xp, self.agents
        rows = decode_globals(xp, self.lay, genomes, self.physics.k_active)
        rows.update(develop(xp, self.rng_dev, self.lay, genomes, self.physics))
        rows["genome"] = genomes
        for k, v in rows.items():
            A[k][idx] = v

    # ------------------------------------------------------------- accounting
    def total_energy(self) -> float:
        A, n = self.agents, self.agents.n
        return (fsum(A["energy"][:n]) + fsum(A["structure"][:n]) + fsum(A["carry"][:n])
                + fsum(self.veg) + fsum(self.cache) + fsum(self.meat)
                + self.cfg.c_build * fsum(self.wall))

    def ledger_error(self) -> float:
        L = self.ledger
        return self.total_energy() - (self.E0 + L["solar"] - L["heat"] + L["immigration"])

    def clone(self):
        return copy.deepcopy(self)

    def __getstate__(self):          # modules and hooks are not state
        d = self.__dict__.copy()
        d.pop("xp", None)
        d["hook"] = None
        return d

    def __setstate__(self, d):
        self.__dict__.update(d)
        self.xp = get_xp(self.cfg.device)
        # upgrade worlds saved by older versions: add agent arrays the schema has gained
        A = self.agents
        ref = Agents.__new__(Agents)
        Agents.__init__(ref, self.cfg.replace(max_agents=1), GenomeLayout(self.cfg), np)
        for k, (shape, dt) in ref.spec.items():
            if k not in A.arr:
                A.arr[k] = self.xp.zeros((A.A,) + shape, dtype=dt)
        for k in ("policy", "lesion"):
            self.__dict__.setdefault(k, None)
        if "rng_occ" not in self.__dict__:
            self.rng_occ = self.xp.random.default_rng(self.cfg.seed + 31337)

    def snapshot(self) -> dict:
        """Scalar summary for logging; resets per-interval counters."""
        xp, A = self.xp, self.agents
        n = A.n
        out = {"t": self.t, "pop": n, "physics_level": self.physics.level,
               "k_active": self.physics.k_active}
        if n:
            g = lambda k: to_numpy(A[k][:n])  # noqa: E731
            out.update(
                energy=float(g("energy").mean()), size=float(g("size").mean()),
                neurons=float(g("n_neurons").mean()),
                neurons_max=float(g("n_neurons").max()),
                gen_mean=float(g("gen").mean()), gen_max=int(g("gen").max()),
                eta_mean=float((g("eta").sum(1) / np.maximum(g("n_neurons"), 1)).mean()),
                eta_pred=float(g("eta_pred").mean()),
                epi_rho=float(g("epi_rho").mean()),
                meat_eff=float(g("eff")[:, -1].mean()),
                surprise=float(g("surprise").mean()),
                alpha_mean=float((g("alpha") * g("mask")).sum(1).mean() / max(1, g("n_neurons").mean())),
                age=float(g("age").mean()),
                deprivation=float((g("energy") < 0.5).mean()),
                log_sigma=float(to_numpy(A["genome"][:n, self.lay.gs["log_sigma"].start]).mean()),
                temp=float(g("temp").mean()),
                pain_mean=float(g("pain").mean()),
                types_active=float((g("n_neurons") > 0).mean() and
                                   (to_numpy(self.lay.t(A["genome"][:n], "count")[:, :, 0]) >= 1).sum(1).mean()),
            )
        c = dict(self.counters)
        deaths = max(c.get("deaths", 0), 1)
        c["mean_lifespan"] = c.get("lifespan_sum", 0) / deaths
        out.update({k: float(v) for k, v in c.items()})
        hist = self.action_hist / max(1, self.action_hist.sum())
        out["action_frac"] = {name: round(float(h), 4) for name, h in
                              zip(["noop", "fwd", "left", "right", "eat", "attack",
                                   "repro", "pick", "drop", "build", "share"], hist)}
        out["veg"] = fsum(self.veg)
        out["walls"] = fsum(self.wall)
        out["cache"] = fsum(self.cache)
        out["ledger_err"] = self.ledger_error()
        self.counters.clear()
        self.action_hist[:] = 0
        return out


def _diffuse(xp, f, D):
    return (1 - 4 * D) * f + D * (xp.roll(f, 1, -1) + xp.roll(f, -1, -1)
                                  + xp.roll(f, 1, -2) + xp.roll(f, -1, -2))


def _box(xp, f, r):
    g = f.copy()
    for k in range(1, r + 1):
        g += xp.roll(f, k, -1) + xp.roll(f, -k, -1)
    h = g.copy()
    for k in range(1, r + 1):
        h += xp.roll(g, k, -2) + xp.roll(g, -k, -2)
    return h
