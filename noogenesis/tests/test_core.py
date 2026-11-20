import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from noogenesis.brain import develop, inherit_slot_map, packed_types  # noqa: E402
from noogenesis.config import BUILD, FWD, NA, Config  # noqa: E402
from noogenesis.genome import (GenomeLayout, crossover, mutate,  # noqa: E402
                               random_genomes, type_counts)
from noogenesis.unfolding import Physics, unfold  # noqa: E402
from noogenesis.world import FRONT_P, PATCH, World  # noqa: E402


def small(**kw):
    base = dict(H=40, W=40, max_agents=400, init_agents=150, min_agents=40, seed=3)
    base.update(kw)
    return Config(**base)


def test_energy_conservation_all_physics():
    w = World(small())
    for _ in range(6):                       # unfold everything, incl. building
        w.unfold()
    for _ in range(400):
        w.step()
    rel = abs(w.ledger_error()) / w.total_energy()
    assert rel < 2e-4, rel
    assert w.ledger["solar"] > 0 and w.ledger["heat"] > 0


def test_types_view_and_latent_loci():
    cfg = small()
    lay = GenomeLayout(cfg)
    rng = np.random.default_rng(0)
    phys = Physics()
    mask = lay.mutable_mask(phys)
    g = random_genomes(np, rng, lay, 32, mask)
    assert np.shares_memory(lay.types(g), g)
    assert np.all(g[:, ~mask] == 0)
    for _ in range(50):
        g = mutate(np, rng, lay, g, mask)
    assert np.all(g[:, ~mask] == 0), "latent loci must stay silent until unfolded"


def test_duplication_adds_module():
    cfg = small(p_dup=1.0, p_del=0.0)
    lay = GenomeLayout(cfg)
    rng = np.random.default_rng(1)
    mask = lay.mutable_mask(Physics())
    g = random_genomes(np, rng, lay, 64, mask)
    before = (lay.t(g, "count")[:, :, 0] >= 1).sum(1)
    g = mutate(np, rng, lay, g.copy(), mask)
    after = (lay.t(g, "count")[:, :, 0] >= 1).sum(1)
    assert (after >= before).all() and (after > before).mean() > 0.8


def test_crossover_is_modular():
    cfg = small()
    lay = GenomeLayout(cfg)
    rng = np.random.default_rng(2)
    a = np.zeros((8, lay.L), np.float32)
    b = np.ones((8, lay.L), np.float32)
    c = crossover(np, rng, lay, a, b)
    T = lay.types(c)
    whole = (T == 0).all(2) | (T == 1).all(2)
    assert whole.all()


def test_packed_development():
    cfg = small()
    lay = GenomeLayout(cfg)
    rng = np.random.default_rng(4)
    g = random_genomes(np, rng, lay, 16, lay.mutable_mask(Physics()))
    br = develop(np, rng, lay, g, Physics())
    cnt = type_counts(np, lay, g).sum(1)
    assert np.allclose(br["n_neurons"], cnt)
    for i in range(16):
        k = int(cnt[i])
        assert br["mask"][i, :k].all() and not br["mask"][i, k:].any()
        assert np.all(br["W"][i, k:, :] == 0) and np.all(br["W"][i, :, k:] == 0)
        assert np.all(br["V"][i, BUILD] == 0), "latent action must be silent"
    smap = inherit_slot_map(np, lay, g, g)
    for i in range(16):
        k = int(cnt[i])
        assert (smap[i, :k] == np.arange(k)).all() and (smap[i, k:] == -1).all()


def test_egocentric_vision_rotates_with_heading():
    w = World(small(init_agents=0, immigration=False), populate=False)
    xp = w.xp
    g = w.random_genomes(1)
    for heading, (dy, dx) in enumerate([(-1, 0), (0, 1), (1, 0), (0, -1)]):
        w2 = World(small(init_agents=0, immigration=False), populate=False)
        w2.veg[:] = 0
        w2.spawn(g.copy(), positions=xp.array([[20, 20]], np.int32),
                 headings=xp.array([heading], np.int32))
        w2.veg[0, 20 + dy, 20 + dx] = 1.0
        Xv, *_ = w2._sense(w2.occupancy(), None)
        assert Xv[0, 0, FRONT_P] == 1.0
        assert Xv[0, 0].sum() == 1.0


def test_occupancy_unique_after_many_steps():
    w = World(small())
    for _ in range(300):
        w.step()
        p = w.agents["pos"][:w.agents.n]
        lin = p[:, 0] * w.cfg.W + p[:, 1]
        assert np.unique(lin).size == lin.size
        assert (w.wall[p[:, 0], p[:, 1]] < 0.5).all()


def test_clone_is_deterministic():
    w = World(small())
    for _ in range(20):
        w.step()
    c = w.clone()
    for _ in range(30):
        w.step()
        c.step()
    assert w.agents.n == c.agents.n
    assert np.allclose(w.veg, c.veg)
    assert np.array_equal(w.agents["pos"][:w.agents.n], c.agents["pos"][:c.agents.n])


@pytest.mark.parametrize("rungs", [1, 2, 3, 4])
def test_unfolding_is_conservative(rungs):
    """At the moment a latent dimension unfolds, no living organism behaves differently."""
    w = World(small(repro=False))
    for _ in range(30):
        w.step()
    c = w.clone()
    for _ in range(rungs):
        c.unfold()
    ra, rb = w.step(record=True), c.step(record=True)
    assert np.array_equal(ra["act"], rb["act"])
    assert np.allclose(ra["out"][:, :NA], rb["out"][:, :NA])


def test_assays_and_metrics_run():
    from noogenesis.assays import battery
    from noogenesis.language import lesson_battery, representation_atlas, xenolexicon
    from noogenesis.metrics import communication_metrics, neural_summary, record_hidden
    w = World(small())
    for _ in range(50):
        w.step()
    g = np.asarray(w.agents["genome"][:9])
    res = battery(g, w.cfg, w.physics, quick=True)
    assert 0.0 <= res["visible_eat_rate"] <= 1.0
    assert "memory_index_d3" in res
    les = lesson_battery(g, w.cfg, w.physics, trials=6)
    assert "symbol_learning" in les
    cm = communication_metrics(w, steps=20)
    assert cm["n_samples"] > 0
    tr = record_hidden(w, steps=60)
    ns = neural_summary(tr)
    assert ns["n"] >= 0
    at = representation_atlas(w, steps=40, lag=3)
    assert isinstance(at, dict)
    assert isinstance(xenolexicon(w, steps=20, min_count=5), dict)


def test_invasion_screen_pairing_is_exact():
    """With mutation switched off, treatment and control are the same world,
    so common random numbers must give s = 0 exactly for every probe."""
    from noogenesis.accelerate import InvasionScreen
    w = World(small(p_gene=0.0, p_dup=0.0, p_del=0.0, tau_sigma=0.0))
    for _ in range(40):
        w.step()
    r = InvasionScreen(n_probes=12, horizon=40, replicates=2).run(w)
    assert np.allclose(np.array(r["s_reps"]), 0.0)
    assert r["written"] == 0


def test_record_hidden_survives_changing_brain_width():
    from noogenesis.metrics import record_hidden
    w = World(small())
    for _ in range(20):
        w.step()
    tr = record_hidden(w, steps=80, max_agents=20, min_neurons=1)
    assert all(X.shape == (80, w.cfg.N) for X in tr.values())


def test_file_migration_between_islands(tmp_path):
    from noogenesis.sim import Simulation
    d = str(tmp_path / "mig")
    a = Simulation(small(seed=1), migrate_dir=d, migrate_every=20, n_migrants=5,
                   island_id=0, verbose=False)
    b = Simulation(small(seed=2), migrate_dir=d, migrate_every=20, n_migrants=5,
                   island_id=1, verbose=False)
    a.run(20)
    b.run(20)          # b reads a's emigrants
    a.run(20)          # a reads b's emigrants
    assert b.migrants_received == 5 and a.migrants_received == 5
    assert abs(b.world.ledger_error()) / b.world.total_energy() < 2e-4


def test_archipelago_bandit_prefers_active_island():
    from noogenesis.archipelago import Archipelago
    arch = Archipelago([small(seed=s, init_agents=60) for s in (1, 2)], verbose=False)
    arch.value[:] = [1.0, 0.0]
    arch.pulls[:] = [5.0, 5.0]
    arch.run(1, budget=40)
    share = arch.alloc_history[-1]
    assert share[0] > share[1] >= 0.05 / 2


@pytest.mark.parametrize("rf_mode,tectum,arcs", [("pixel", False, False), ("gaussian", False, False),
                                                 ("pixel", True, False), ("pixel", False, True)])
def test_bilateral_brain_is_mirror_symmetric(rf_mode, tectum, arcs):
    """With developmental noise off and paired neurons, mirroring the world
    (vision, sound, efference copy) must swap the left/right turn logits and
    leave every other output unchanged."""
    from noogenesis.brain import _MIRROR_P, _mirror_other, _mirror_sign, brain_forward, develop
    from noogenesis.config import LEFT, RIGHT
    cfg = small(bilateral=True, rf_mode=rf_mode, tectum=tectum, reflex_arcs=arcs)
    lay = GenomeLayout(cfg)
    rng = np.random.default_rng(7)
    phys = Physics(k_active=4, s_active=4, p_active=2, building=True)
    g = random_genomes(np, rng, lay, 6, lay.mutable_mask(phys))
    T = lay.types(g)
    T[:, :, lay.ts["dev_noise"].start] = -20.0
    T[:, :, lay.ts["count"].start] = np.where(T[:, :, lay.ts["count"].start] >= 1, 4.0, -1.0)
    B = develop(np, rng, lay, g, phys)
    n, Ne = 6, int(B["n_neurons"].max())
    from noogenesis.config import vision_channels, n_other_inputs
    Xv = rng.random((n, vision_channels(cfg), 25)).astype(np.float32)
    Xo = rng.standard_normal((n, n_other_inputs(cfg))).astype(np.float32)
    _, out = brain_forward(np, B, n, Ne, Xv, Xo, True, True, arcs)
    _, outm = brain_forward(np, B, n, Ne, Xv[:, :, _MIRROR_P], Xo[:, _mirror_other(cfg)] * _mirror_sign(cfg),
                            True, True, arcs)
    assert np.allclose(out[:, LEFT], outm[:, RIGHT], atol=1e-4)
    assert np.allclose(out[:, RIGHT], outm[:, LEFT], atol=1e-4)
    keep = [i for i in range(out.shape[1]) if i not in (LEFT, RIGHT)]
    assert np.allclose(out[:, keep], outm[:, keep], atol=1e-4)


def test_invasion_harness_is_fair():
    """Identical strategies must score ~1 against each other."""
    from noogenesis.oracles import Taste, invasion
    r = invasion(small(), Taste(seed=1), Taste(seed=2), n_agents=150, settle=50, measure=150)
    assert 0.7 < r["ratio"] < 1.4, r


def test_vision_lesion_silences_tectum():
    w = World(small(tectum=True))
    for _ in range(5):
        w.step()
    seen = []
    w.hook = lambda wd, n, Ne, Xv, Xo, h, out: seen.append((float(abs(Xv).sum()), float(abs(Xo[:, -5:]).sum())))
    w.lesion = "vision"
    w.step()
    assert seen and seen[0] == (0.0, 0.0)


def test_invasion_counts_toxic_food_as_harmful():
    """A strategy that only eats toxic food must score below one that eats everything."""
    from noogenesis.oracles import invasion, Reflex
    kw = dict(n_agents=150, settle=50, measure=150)
    tox = invasion(small(tox_period=200, tox_value=1.0), Reflex(seed=1), Reflex(seed=2), **kw)
    clean = invasion(small(), Reflex(seed=1), Reflex(seed=2), **kw)
    assert tox["resident"] < 0.5 * clean["resident"]
    w = World(small(tox_period=200))
    vals = set()
    for _ in range(220):
        w.step()
        vals.add(tuple(np.round(w.species_value[:2], 2)))
    assert (1.0, -1.0) in vals and (-1.0, 1.0) in vals


def test_salience_learning_tracks_value_sign():
    """Plastic salience: eating a food whose value is positive must move its learned
    salience in the direction of the value coupling, and only food channels learn."""
    from noogenesis.config import EAT
    cfg = small(sal_learning=True, init_agents=0, immigration=False, repro=False,
                deaths=False, growth=False, climate=False)
    w = World(cfg, populate=False)
    w.force_day = True
    g = np.asarray(w.random_genomes(1)).copy()
    g[:, w.lay.gs["sal_eta"].start] = 6.0
    g[:, w.lay.gs["sal_dE"].start] = 3.0
    w.spawn(g, positions=np.array([[20, 20]], np.int32), headings=np.array([0], np.int32))
    w.veg[:] = 0
    w.veg[0, 20, 20] = 1.0
    for _ in range(6):
        w.policy = lambda wd, n, Xv: np.full(n, EAT)
        w.step()
    F = np.asarray(w.agents["sal_F"][0])
    K = cfg.K_max
    assert F[0] > 0 and np.all(F[K + 2:] == 0)
