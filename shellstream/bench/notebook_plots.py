# Plots of the development-run results (used by the notebook and by the report figures).
import os as _os
import numpy as _np
import matplotlib.pyplot as _plt

PAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']
INK, INK2 = '#0b0b0b', '#52514e'
MODE_NAMES = {'stale': 'classic (stale frame)', 'rot': 'rotation-only warp', 'naive': 'naive depth warp',
              'noback': 'ShellStream, no background band', 'shell1': 'ShellStream, one shell (1 GPU)',
              'shell': 'ShellStream, both T4s (2 shells)'}
MODE_ORDER = ['stale', 'rot', 'naive', 'noback', 'shell1', 'shell']


def _style(ax, title=None, xlabel=None, ylabel=None):
    ax.grid(axis='y', alpha=.25, lw=.8)
    ax.spines[['top', 'right']].set_visible(False)
    for s in ('left', 'bottom'):
        ax.spines[s].set_color('#bdbcb6')
    ax.tick_params(colors=INK2, labelsize=9)
    if title: ax.set_title(title, loc='left', fontsize=11, color=INK, pad=8)
    if xlabel: ax.set_xlabel(xlabel, color=INK2, fontsize=9)
    if ylabel: ax.set_ylabel(ylabel, color=INK2, fontsize=9)


def plot_latency(R, ax):
    steps = R['latency']['steps']
    for i, mode in enumerate(['classic', 'shell']):
        rows = sorted([r for r in steps if r['mode'] == mode], key=lambda r: r['rtt_ms'])
        x = [r['rtt_ms'] for r in rows]
        y = [r['pixel_ms_median'] for r in rows]
        lo = [r['pixel_ms_median'] for r in rows]
        hi = [r['pixel_ms_p90'] for r in rows]
        c = PAL[1] if mode == 'classic' else PAL[0]
        ax.plot(x, y, '-o', color=c, lw=2, ms=6, label='classic streaming' if mode == 'classic' else 'ShellStream')
        ax.fill_between(x, lo, hi, color=c, alpha=.12, lw=0)
        ax.annotate('classic streaming' if mode == 'classic' else 'ShellStream', (x[-1], y[-1]), xytext=(6, 0),
                    textcoords='offset points', va='center', fontsize=9, color=INK2)
    ax.legend(frameon=False, fontsize=9, loc='upper left')
    _style(ax, 'Look latency vs. network round trip', 'emulated RTT (ms)', 'input -> changed framebuffer (ms, median; band = p90)')
    ax.set_ylim(bottom=0)


def plot_stall(R, ax):
    st = R['latency']['stall']
    first = True
    for i, mode in enumerate(['classic', 'shell']):
        if mode not in st: continue
        s = st[mode]['series']
        t = [p['t'] for p in s]
        lag = [_np.degrees((p['yaw'] - p['shown'] + _np.pi) % (2 * _np.pi) - _np.pi) for p in s]   # wrap to +-180
        c = PAL[1] if mode == 'classic' else PAL[0]
        ax.plot(t, lag, color=c, lw=2, label='classic streaming' if mode == 'classic' else 'ShellStream')
    ax.axvspan(0, 1000, color='#bdbcb6', alpha=.25, lw=0)
    ax.text(500, ax.get_ylim()[1] * 0.92, 'downlink frozen for 1 s', ha='center', fontsize=9, color=INK2)
    ax.legend(frameon=False, fontsize=9, loc='upper right')
    _style(ax, 'Turning at 1 rad/s through a network stall', 'time since stall began (ms)', 'displayed view lags input by (deg)')


def plot_quality(R, ax_rot, ax_tr):
    rows = R['quality']
    offs = []
    for r in rows:
        if r['offset'] not in offs: offs.append(r['offset'])
    rot = [o for o in offs if o == 'none' or o.startswith('yaw') or o.startswith('pitch')]
    tr = [o for o in offs if o not in rot]
    for ax, group, title in ((ax_rot, rot, 'Image quality after rotating (vs. ground truth)'),
                             (ax_tr, tr, 'Image quality after moving (vs. ground truth)')):
        n = len(MODE_ORDER)
        w = 0.8 / n
        x = _np.arange(len(group))
        for i, m in enumerate(MODE_ORDER):
            vals = [_np.mean([r['psnr'] for r in rows if r['offset'] == o and r['mode'] == m]) for o in group]
            ax.bar(x + (i - (n - 1) / 2) * w, vals, w * 0.86, color=PAL[[1, 2, 3, 4, 5, 0][i]], label=MODE_NAMES[m])
        ax.set_xticks(x); ax.set_xticklabels(group, rotation=20, ha='right', fontsize=8)
        _style(ax, title, None, 'PSNR (dB), mean of 3 scenes')
        ax.set_ylim(10, max(40, ax.get_ylim()[1]))
    # one legend for both panels, above them, so it never covers bars
    h, l = ax_rot.get_legend_handles_labels()
    ax_rot.figure.legend(h, l, loc='lower center', bbox_to_anchor=(0.5, 1.0), ncol=6, frameon=False, fontsize=9)


def plot_bandwidth(R, ax):
    shells = R['bandwidth']['shells']
    labels, stacks = [], []
    keys = []
    for s in shells:
        for k in s['parts']:
            if k not in keys: keys.append(k)
    groups = {'focus colour': ['front colour'], 'focus depth+topology': ['front depth', 'front topology'],
              'background band': ['back colour', 'back depth', 'back topology'],
              'omni cube': ['omni colour', 'omni depth', 'omni topology'], 'brick+header': ['collision brick', 'header']}
    y = _np.arange(len(shells))
    left = _np.zeros(len(shells))
    for i, (g, ks) in enumerate(groups.items()):
        v = _np.array([sum(s['parts'].get(k, 0) for k in ks) / 1024 for s in shells])
        ax.barh(y, v, left=left, color=PAL[i], height=0.62, label=g, edgecolor='white', linewidth=1)
        left += v
    cl = _np.array([s['classic_jpeg_1080p'] / 1024 for s in shells])
    ax.scatter(cl, y, marker='|', s=260, color=INK, zorder=3, label='classic 1080p JPEG frame')
    ax.set_yticks(y); ax.set_yticklabels([f"{s['scene']}, {s['motion']}" for s in shells], fontsize=8)
    ax.invert_yaxis()
    ax.legend(frameon=False, fontsize=8, ncol=3, loc='lower right', bbox_to_anchor=(1, -0.42))
    _style(ax, 'Bytes per shell, 1920x1080 / 90 deg client', 'KiB', None)
    ax.grid(axis='x', alpha=.25); ax.grid(axis='y', alpha=0)


def plot_cost(R, ax):
    cm = R['cost_model']['t4_ms']
    mid = cm[sorted(cm)[1]]
    lo = cm[sorted(cm)[2]]
    hi = cm[sorted(cm)[0]]
    names = ['front_color', 'front_geometry', 'background_band', 'omni_color', 'omni_geometry', 'classic_1080p']
    pretty = ['focus colour 1280x800, 2 spp', 'focus geometry', 'background band', 'omni colour 6x256^2', 'omni geometry', 'classic 1080p frame, 2 spp']
    y = _np.arange(len(names))
    ax.barh(y, [mid[n] for n in names], color=[PAL[0]] * 5 + [PAL[1]], height=0.6)
    ax.errorbar([mid[n] for n in names], y, xerr=[[mid[n] - lo[n] for n in names], [hi[n] - mid[n] for n in names]],
                fmt='none', ecolor=INK2, lw=1, capsize=3)
    ax.set_yticks(y); ax.set_yticklabels(pretty, fontsize=8); ax.invert_yaxis()
    _style(ax, 'Modelled T4 time per pass (one GPU)', 'ms (bar: mid estimate, whiskers: range)', None)
    ax.grid(axis='x', alpha=.25); ax.grid(axis='y', alpha=0)


def plot_disocc(R, ax):
    D = R['disocclusion']
    modes = [m for m in MODE_ORDER if all(m in r for r in D)]
    vals = [_np.mean([r[m] for r in D if r[m] is not None]) for m in modes]
    cols = [PAL[[1, 2, 3, 4, 5, 0][MODE_ORDER.index(m)]] for m in modes]
    y = _np.arange(len(modes))
    ax.barh(y, vals, color=cols, height=0.6)
    for yi, v in zip(y, vals):
        ax.text(v + 0.2, yi, f'{v:.1f} dB', va='center', fontsize=9, color=INK2)
    ax.set_yticks(y); ax.set_yticklabels([MODE_NAMES[m] for m in modes], fontsize=9); ax.invert_yaxis()
    _style(ax, 'PSNR inside newly revealed regions only (0.5 m strafes, 3 scenes)', 'dB', None)
    ax.grid(axis='x', alpha=.25); ax.grid(axis='y', alpha=0)


def plot_host(R, ax_lat, ax_mis):
    h2 = R['host']['h2']
    rtts = sorted({r['rtt_ms'] for r in h2})
    for pred, c, lab in ((False, PAL[1], 'prediction off (classic streaming)'), (True, PAL[0], 'input-predicted reprojection')):
        y = [next(r['latency_ms_median'] for r in h2 if r['rtt_ms'] == t and r['prediction'] == pred) for t in rtts]
        ax_lat.plot(rtts, y, '-o', color=c, lw=2, ms=6, label=lab)
    ax_lat.legend(frameon=False, fontsize=9, loc='upper left'); ax_lat.set_ylim(bottom=0)
    _style(ax_lat, 'Any unmodified game (Minetest): mouse-look latency', 'emulated RTT (ms)', 'input -> changed framebuffer (ms, median)')
    h1 = [r for r in R['host']['h1']['rows'] if r['step_counts'][1] == 0 and r['step_counts'][0] > 0]
    x = _np.arange(len(h1)); w = 0.38
    ax_mis.bar(x - w / 2, [r['misalign_px_stale'] for r in h1], w * 0.9, color=PAL[1], label='stale frame (classic)')
    pv = [r['misalign_px_predicted'] for r in h1]
    ax_mis.bar(x + w / 2, pv, w * 0.9, color=PAL[0], label='predicted')
    top = max(r['misalign_px_stale'] for r in h1)
    for xi, v in zip(x, pv):          # the predicted bars are often too short to see: say their value
        ax_mis.text(xi + w / 2, v + top * 0.015, f"{v:.1f} px", ha='center', va='bottom', fontsize=8, color=INK2)
    ax_mis.set_xticks(x); ax_mis.set_xticklabels([f"{r['step_counts'][0]} counts" for r in h1], fontsize=8)
    ax_mis.legend(frameon=False, fontsize=9, loc='upper left')
    _style(ax_mis, 'How far the shown image is from the game\'s next frame', 'mouse step', 'misalignment (px)')


def plot_all(R, save=None):
    figs = []
    if 'latency' in R:
        fig, ax = _plt.subplots(1, 2, figsize=(14, 4.3))
        plot_latency(R, ax[0]); plot_stall(R, ax[1]); fig.tight_layout(); figs.append(('latency', fig))
    if 'quality' in R:
        fig, ax = _plt.subplots(1, 2, figsize=(15, 4.8), gridspec_kw=dict(width_ratios=[6, 8]))
        plot_quality(R, ax[0], ax[1]); fig.tight_layout(); figs.append(('quality', fig))
    if 'host' in R:
        fig, ax = _plt.subplots(1, 2, figsize=(14, 4.2))
        plot_host(R, ax[0], ax[1]); fig.tight_layout(); figs.append(('host', fig))
    if 'disocclusion' in R:
        fig, ax = _plt.subplots(1, 1, figsize=(9, 3.6))
        plot_disocc(R, ax); fig.tight_layout(); figs.append(('disocc', fig))
    if 'bandwidth' in R or 'cost_model' in R:
        fig, ax = _plt.subplots(1, 2, figsize=(15, 4.6))
        if 'bandwidth' in R: plot_bandwidth(R, ax[0])
        if 'cost_model' in R: plot_cost(R, ax[1])
        fig.tight_layout(); figs.append(('cost', fig))
    for name, fig in figs:
        if save:
            fig.savefig(_os.path.join(save, f'fig_{name}.png'), dpi=160, bbox_inches='tight', facecolor='#fcfcfb')
    if not save:
        _plt.show()
    return figs


if 'DEV_RESULTS' in globals():
    plot_all(DEV_RESULTS)
