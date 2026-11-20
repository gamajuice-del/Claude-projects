"""All tunable constants of the universe in one place.

Units: energy is dimensionless; one fully grown vegetation cell of one chemical
species holds 1.0 energy. Time is in simulation steps.
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace

# ---- action vocabulary (fixed; latent ones are masked until unfolded) --------
NOOP, FWD, LEFT, RIGHT, EAT, ATTACK, REPRO, PICK, DROP, BUILD, SHARE = range(11)
ACTION_NAMES = ["noop", "fwd", "left", "right", "eat", "attack", "repro",
                "pick", "drop", "build", "share"]
NA = len(ACTION_NAMES)


@dataclass
class Config:
    # ---- world ----
    H: int = 96
    W: int = 96
    seed: int = 0
    device: str = "cpu"          # "cpu" | "cuda:0" | "cuda:1"

    # ---- population ----
    max_agents: int = 2048       # slot capacity (memory is preallocated)
    init_agents: int = 700
    min_agents: int = 120        # below this, random immigrants arrive
    immigrant_archive_frac: float = 0.5  # share of immigrants drawn from the fossil record

    # ---- latent physics maxima (state space is allocated at max size) ----
    K_max: int = 4               # vegetation chemical species
    S_max: int = 4               # sound dimensions
    P_max: int = 2               # pheromone channels
    M_mod: int = 2               # neuromodulator channels

    # ---- initial unfolding state ----
    k_init: int = 2
    s_init: int = 2
    p_init: int = 1
    building_init: bool = False
    night_radius_init: int = 1   # vision radius at night (day radius = 2)

    # ---- brain / genome ----
    G_max: int = 8               # max neuron types (gene modules)
    n_max: int = 8               # max neurons per type -> N = G_max * n_max
    d_aff: int = 8               # affinity (wiring) vector dimension
    R_vis: int = 2               # receptive-field basis functions per type
    init_types: tuple = (2, 4)   # initial active types range [lo, hi]
    F_clip: float = 2.0          # fast-weight bound
    p_dup: float = 0.02          # gene-module duplication probability per birth
    p_del: float = 0.01          # module deletion probability per birth
    p_gene: float = 0.08         # per-locus mutation probability
    rf_mode: str = "pixel"       # "pixel": 25 free weights per receptive field;
                                 # "gaussian": centre (f0, s0) + width (3 genes)
    sigma_init: float = -2.5     # initial log mutation step size
    bilateral: bool = True       # neurons develop in left/right mirror pairs
    tectum: bool = True          # retinotopic salience map + winner-take-all orienting circuit
    temp_min: float = 0.0        # floor on action-selection temperature (behavioural noise)
    reflex_arcs: bool = True     # direct receptive-field / tectum -> action-logit pathways
    arc_learning: bool = False   # three-factor (dopamine-gated actor) learning on the arcs
    c_arc_learn: float = 0.002   # energy per step at maximal arc-learning rate
    arc_features: str = "rf"     # "rf": learn on receptive-field responses; "raw": on the retina
    arc_rpe: bool = True         # value = energy change minus its running mean (RPE)
    auto_repro: bool = True      # budding is triggered physiologically (energy >= threshold);
                                 # the reproduce action then only means "mate"
    sensor_mode: str = "linear"  # "weber": log-compressive food receptors,
                                 # log(1 + x/x0)/log(1 + 1/x0), x0 = weber_x0
    weber_x0: float = 0.03
    tau_sigma: float = 0.2       # self-adaptation rate of the mutation step size

    # ---- metabolism (energy per step) ----
    c_basal: float = 0.010       # * (0.5 + size)
    c_neuron: float = 0.00012    # per active neuron
    c_activity: float = 0.00010  # per unit of |h|
    c_wiring: float = 0.00002    # per unit of sum|W| (paid every step)
    c_plastic: float = 0.0008    # per unit of summed plasticity rate
    c_forward: float = 0.004     # at maximal forward-model learning rate
    c_move: float = 0.004        # * size
    c_attack: float = 0.02
    c_build: float = 0.25        # embodied in the wall
    c_sound: float = 0.002       # * |s|^2
    c_pher: float = 0.004        # * deposit
    c_carry: float = 0.002       # * carried mass
    struct_cost: float = 0.5     # body structure energy per unit size
    birth_overhead: float = 0.15
    heal_rate: float = 0.004
    min_repro_age: int = 25

    # ---- feeding / interaction ----
    bite: float = 0.35
    eff_alpha: float = 0.6       # specialist/generalist trade-off exponent
    eff_max: float = 0.95
    attack_power: float = 0.25
    carry_cap: float = 1.0       # * size
    pick_amount: float = 0.5
    share_min_energy: float = 0.5

    # ---- ecology ----
    site_density: float = 0.08   # fraction of cells that are fruiting sites
    grass_cap: float = 0.25      # biomass cap elsewhere (1.0 everywhere = the dense ecology)
    fruit_cap: float = 1.0       # biomass cap at fruiting sites
    veg_rate: float = 0.12
    veg_seed: float = 0.002
    veg_diffuse: float = 0.0
    n_hotspots: int = 3
    hotspot_sigma: float = 0.13  # fraction of world size
    fert_base: float = 0.15
    meat_decay: float = 0.01
    cache_decay: float = 0.0015
    wall_decay: float = 0.0005
    pher_decay: float = 0.03
    pher_diffuse: float = 0.05

    # ---- multi-timescale drivers (the "cognitive niche window") ----
    day_period: int = 120
    season_period: int = 2400
    season_amp: float = 0.45
    climate_dt: float = 0.0002   # Lorenz time per step (~1 unit / 5000 steps)
    hotspot_speed: float = 0.02  # cells per step

    # ---- run-time switches (assays turn things off) ----
    growth: bool = True
    climate: bool = True
    repro: bool = True
    immigration: bool = True
    deaths: bool = True

    # ---- welfare safeguards (see ethics.py) ----
    pain_cap: float = 1.0        # interoceptive pain signal is clipped here
    deprivation_tripwire: float = 0.6  # fraction of agents in deprivation -> warn

    extra: dict = field(default_factory=dict)

    @property
    def N(self) -> int:
        return self.G_max * self.n_max

    def replace(self, **kw) -> "Config":
        return replace(self, **kw)


# ---- sensor layout (shared by world.py and brain.py) -------------------------
def vision_channels(cfg: Config) -> int:
    # veg(K) + meat + cache + agent + color(3) + wall + pher(P)
    return cfg.K_max + 1 + 1 + 1 + 3 + 1 + cfg.P_max


VIS_RADIUS = 2
N_PATCH = (2 * VIS_RADIUS + 1) ** 2            # 25 egocentric cells
N_SOUND_PTS = 5                                # own, front, right, back, left
N_INTERO = 13
# outputs: actions + sound + pheromone + neuromodulators
def n_outputs(cfg: Config) -> int:
    return NA + cfg.S_max + cfg.P_max + cfg.M_mod


N_TECTUM = 5   # attended (f*, s*), attended salience, salience underfoot, difference


def n_other_inputs(cfg: Config) -> int:
    return N_SOUND_PTS * cfg.S_max + N_INTERO + NA + (N_TECTUM if getattr(cfg, "tectum", False) else 0)


def n_pred_targets(cfg: Config) -> int:
    # 3x3-mean of each channel + front cell channels + 6 intero + own-cell sound
    C = vision_channels(cfg)
    return C + C + 6 + cfg.S_max
