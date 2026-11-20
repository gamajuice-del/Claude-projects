"""Simulation driver: world + open-endedness machinery + safeguards + logging.

One Simulation = one island universe. Islands exchange migrants either
in-process (archipelago.py) or across processes / GPUs / machines through a
shared migration directory (`migrate_dir`), which is the scaling path for
2x T4 and beyond: run one process per GPU, point them at the same directory.
"""
from __future__ import annotations

import glob
import json
import os
import pickle
import time

import numpy as np

from .accelerate import InvasionScreen
from .backend import device_context, to_numpy
from .config import Config
from .ethics import WelfareMonitor
from .unfolding import EvolutionaryActivity, StagnationDetector
from .world import World


class Simulation:
    def __init__(self, cfg: Config, out_dir: str | None = None,
                 unfold_mode: str = "activity", unfold_every: int = 20000,
                 iff: InvasionScreen | None = None, log_every: int = 250,
                 activity_every: int = 100, archive_every: int = 5000,
                 migrate_dir: str | None = None, migrate_every: int = 2000,
                 n_migrants: int = 8, island_id: int = 0, verbose: bool = True):
        self.cfg = cfg
        self.ctx = device_context(cfg.device)
        with self.ctx:
            self.world = World(cfg)
        self.out_dir = out_dir
        self.unfold_mode, self.unfold_every = unfold_mode, unfold_every
        self.iff = iff
        self.log_every, self.activity_every = log_every, activity_every
        self.archive_every = archive_every
        self.migrate_dir, self.migrate_every = migrate_dir, migrate_every
        self.n_migrants, self.island_id = n_migrants, island_id
        self.verbose = verbose
        self.activity = EvolutionaryActivity(self.world.lay.L, seed=cfg.seed + 99)
        self.detector = StagnationDetector()
        self.welfare = WelfareMonitor(deprivation_tripwire=cfg.deprivation_tripwire,
                                      approval_file=(os.path.join(out_dir, "ETHICS_REVIEW_APPROVED")
                                                     if out_dir else None))
        self.records: list[dict] = []
        self._seen_migrants: set[str] = set()
        self.migrants_received = 0
        self._t_wall = time.time()
        self._steps_wall = 0
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)
            os.makedirs(os.path.join(out_dir, "archive"), exist_ok=True)
            self._log = open(os.path.join(out_dir, "metrics.jsonl"), "a")
        else:
            self._log = None

    # ------------------------------------------------------------------ loop
    def run(self, steps: int):
        w = self.world
        with self.ctx:
            for _ in range(steps):
                w.step()
                self._steps_wall += 1
                t = w.t
                if t % self.activity_every == 0:
                    g = to_numpy(w.agents["genome"][:w.agents.n])
                    rec = self.activity.update(t, g)
                    stagnant = self.detector.update(rec["new_activity"])
                    if (self.unfold_mode == "activity" and stagnant
                            and self.welfare.escalation_allowed()):
                        self._unfold()
                if (self.unfold_mode == "schedule" and t % self.unfold_every == 0
                        and self.welfare.escalation_allowed()):
                    self._unfold()
                if self.iff is not None and t % self.iff.every == 0:
                    r = self.iff.run(w)
                    if r and self.verbose:
                        print(f"  [IFS t={t}] s_mean={r['s_mean']:+.3f} "
                              f"beneficial={r['frac_beneficial']:.2f} written={r['written']}")
                if self.migrate_dir and t % self.migrate_every == 0:
                    self._migrate_files()
                if t % self.log_every == 0:
                    self._log_snapshot()
                if self.out_dir and t % self.archive_every == 0:
                    self._archive()
        return self

    def _unfold(self):
        what = self.world.unfold()
        if what and self.verbose:
            print(f"  >>> t={self.world.t}: physics unfolded: {what}")

    def _log_snapshot(self):
        w = self.world
        snap = w.snapshot()
        if self.activity.history:
            h = self.activity.history[-1]
            snap.update(new_activity=h["new_activity"], components=h["components"],
                        genetic_diversity=h["diversity"])
        dt = time.time() - self._t_wall
        snap["steps_per_s"] = self._steps_wall / max(dt, 1e-9)
        self._t_wall, self._steps_wall = time.time(), 0
        snap["welfare"] = self.welfare.observe_snapshot(snap)
        snap["events"] = [e for e in w.events if e[0] > w.t - self.log_every]
        self.records.append(snap)
        if self._log:
            self._log.write(json.dumps(snap) + "\n")
            self._log.flush()
        if self.verbose:
            print(f"t={snap['t']:>7} pop={snap['pop']:>5} gen~{snap.get('gen_mean', 0):6.1f} "
                  f"neur={snap.get('neurons', 0):5.1f}/{snap.get('neurons_max', 0):3.0f} "
                  f"E={snap.get('energy', 0):4.2f} life={snap.get('mean_lifespan', 0):5.0f} "
                  f"eat={snap['action_frac']['eat']:.2f} lvl={snap['physics_level']} "
                  f"div={snap.get('genetic_diversity', 0):4.2f} {snap['steps_per_s']:5.0f} st/s")

    def _archive(self, k: int = 256):
        w = self.world
        A = w.agents
        n = A.n
        if n == 0:
            return
        idx = np.random.default_rng(w.t).permutation(n)[:k]
        xi = w.xp.asarray(idx)
        np.savez_compressed(
            os.path.join(self.out_dir, "archive", f"t{w.t:08d}.npz"),
            genomes=to_numpy(A["genome"][xi]), ids=to_numpy(A["id"][xi]),
            parent=to_numpy(A["parent"][xi]), gen=to_numpy(A["gen"][xi]),
            t=w.t, physics=json.dumps(w.physics.as_dict()))

    def save_state(self, path: str):
        """Full serialisation (the non-destruction safeguard)."""
        with open(path, "wb") as f:
            pickle.dump(self.world, f)

    # --------------------------------------------------------------- migrate
    def emigrants(self, k):
        w = self.world
        n = w.agents.n
        if n == 0:
            return np.zeros((0, w.lay.L), np.float32)
        idx = np.random.default_rng(w.t + self.island_id).permutation(n)[:k]
        return to_numpy(w.agents["genome"][w.xp.asarray(idx)]).copy()

    def receive(self, genomes: np.ndarray):
        w = self.world
        if genomes.size == 0:
            return 0
        g = w.xp.asarray(genomes.astype(np.float32))
        g[:, ~w.mutable_xp] = 0.0      # migrants must obey local physics
        got = w.spawn(g, energy=3.0, immigration=True)
        w.counters["migrants_in"] += got
        self.migrants_received += got
        return got

    def _migrate_files(self):
        d = self.migrate_dir
        os.makedirs(d, exist_ok=True)
        np.save(os.path.join(d, f"island{self.island_id}_t{self.world.t}.npy"),
                self.emigrants(self.n_migrants))
        for f in sorted(glob.glob(os.path.join(d, "island*_t*.npy"))):
            if f in self._seen_migrants or os.path.basename(f).startswith(f"island{self.island_id}_"):
                continue
            self._seen_migrants.add(f)
            try:
                self.receive(np.load(f))
            except (OSError, ValueError):
                pass
