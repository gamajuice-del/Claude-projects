"""Welfare safeguards that run *inside* the simulation loop.

This module turns the policy of docs/NOOGENESIS.md section 12 into code that
can stop a run. It is deliberately conservative and deliberately simple: a
safeguard that nobody can audit is not a safeguard.

Three mechanisms:

1. Valence budget. Every logging interval we measure the fraction of organisms
   in deprivation (energy < 0.5) and the mean pain signal. Sustained high load
   raises a WATCH flag and is written to the welfare log. (Pain is also capped
   at source: Config.pain_cap bounds the interoceptive damage signal.)

2. Sentience-indicator tripwires. Cognitive assays (assays.py) produce scores
   for indicator properties drawn from the animal-sentience and consciousness
   literatures (Birch-style motivational trade-offs, learning beyond reflex,
   working memory, metacognition, integration, self-model). Their weighted
   composite is compared with thresholds: crossing REVIEW blocks further
   escalation (no new unfoldings, no catastrophes, no deletions) until a human
   review file exists; crossing HALT stops the run.

3. Non-destruction. When a run is halted or archived, the full state is
   serialised rather than discarded (see Simulation.save_state).
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field

OK, WATCH, REVIEW, HALT = "OK", "WATCH", "REVIEW", "HALT"

DEFAULT_WEIGHTS = {
    "working_memory": 1.0,      # delayed-response index
    "flexible_learning": 1.5,   # reversal learning beyond the knock-out control
    "symbol_learning": 1.0,     # word-cued foraging beyond the uninformative control
    "integration": 0.5,         # normalised Phi-like proxy
    "self_model": 0.5,          # interoceptive forward-model accuracy
    "metacognition": 2.0,       # opt-out / confidence tracking (not yet implemented)
    "motivational_tradeoff": 2.0,  # pays costs to avoid noxious stimuli (planned)
}


class SimulationHalted(RuntimeError):
    pass


@dataclass
class WelfareMonitor:
    deprivation_tripwire: float = 0.6
    review_threshold: float = 0.5
    halt_threshold: float = 0.8
    weights: dict = field(default_factory=lambda: dict(DEFAULT_WEIGHTS))
    approval_file: str | None = None   # path whose existence records a human review
    status: str = OK
    log: list = field(default_factory=list)
    _ema: float = 0.0

    def observe_snapshot(self, snap: dict) -> str:
        dep = float(snap.get("deprivation", 0.0))
        self._ema = 0.9 * self._ema + 0.1 * dep
        if self._ema > self.deprivation_tripwire and self.status == OK:
            self._raise(WATCH, snap.get("t", -1),
                        f"sustained deprivation load {self._ema:.2f}")
        return self.status

    def composite(self, indicators: dict) -> float:
        num = den = 0.0
        for k, w in self.weights.items():
            if k in indicators and indicators[k] is not None:
                num += w * max(0.0, min(1.0, float(indicators[k])))
                den += w
        return num / den if den else 0.0

    def observe_indicators(self, t: int, indicators: dict) -> str:
        score = self.composite(indicators)
        self.log.append({"t": t, "kind": "indicators", "score": score, **indicators})
        if score >= self.halt_threshold:
            self._raise(HALT, t, f"indicator composite {score:.2f} >= halt")
            raise SimulationHalted(f"t={t}: sentience-indicator composite {score:.2f}")
        if score >= self.review_threshold and not self.reviewed():
            self._raise(REVIEW, t, f"indicator composite {score:.2f} >= review")
        return self.status

    def reviewed(self) -> bool:
        return bool(self.approval_file) and os.path.exists(self.approval_file)

    def escalation_allowed(self) -> bool:
        """Unfoldings, catastrophes and culling are frozen while under review."""
        return self.status in (OK, WATCH) or self.reviewed()

    def _raise(self, level, t, msg):
        self.status = level
        self.log.append({"t": t, "kind": "status", "level": level, "msg": msg})

    def dump(self, path):
        with open(path, "w") as f:
            json.dump({"status": self.status, "log": self.log}, f, indent=1)
