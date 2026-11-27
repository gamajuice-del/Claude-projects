"""Small helpers over skia for the Void Vigil film: paths, fills, glows, gradients."""
import math

import numpy as np
import skia

TAU = 2 * math.pi


def rgb(c, a=1.0):
    return skia.Color(int(c[0]), int(c[1]), int(c[2]), int(max(0, min(1, a)) * 255))


def mix(c0, c1, u):
    u = max(0.0, min(1.0, u))
    return tuple(c0[i] + (c1[i] - c0[i]) * u for i in range(3))


def path(cmds, close=True):
    """cmds: ('M', x, y) ('L', x, y) ('C', x1, y1, x2, y2, x, y) ('Q', x1, y1, x, y)."""
    p = skia.Path()
    for c in cmds:
        k = c[0]
        if k == 'M':
            p.moveTo(c[1], c[2])
        elif k == 'L':
            p.lineTo(c[1], c[2])
        elif k == 'C':
            p.cubicTo(*c[1:])
        elif k == 'Q':
            p.quadTo(*c[1:])
    if close:
        p.close()
    return p


def mirror_x(cmds):
    out = []
    for c in cmds:
        k = c[0]
        v = list(c[1:])
        for i in range(0, len(v), 2):
            v[i] = -v[i]
        out.append((k, *v))
    return out


def sym_path(right_half, top, bottom):
    """A left-right symmetric closed path from the right half outline, which
    runs from (0, top) clockwise to (0, bottom)."""
    cmds = [('M', 0, top)] + right_half
    # walk the left half back up: reverse the right half, mirrored
    pts = [(0, top)]
    for c in right_half:
        pts.append((c[-2], c[-1]))
    rev = []
    segs = right_half
    for i in range(len(segs) - 1, -1, -1):
        c = segs[i]
        start = pts[i]
        if c[0] == 'C':
            rev.append(('C', -c[3], c[4], -c[1], c[2], -start[0], start[1]))
        elif c[0] == 'Q':
            rev.append(('Q', -c[1], c[2], -start[0], start[1]))
        else:
            rev.append(('L', -start[0], start[1]))
    return path(cmds + rev)


def paint(color, a=1.0, aa=True, stroke=None, blur=None, shader=None, blend=None):
    p = skia.Paint(AntiAlias=aa)
    p.setColor(rgb(color, a))
    if stroke:
        p.setStyle(skia.Paint.kStroke_Style)
        p.setStrokeWidth(stroke)
        p.setStrokeCap(skia.Paint.kRound_Cap)
        p.setStrokeJoin(skia.Paint.kRound_Join)
    if blur:
        p.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, blur))
    if shader is not None:
        p.setShader(shader)
    if blend:
        p.setBlendMode(blend)
    return p


def fill(cv, p, color, a=1.0, **kw):
    cv.drawPath(p, paint(color, a, **kw))


def outline(cv, p, color, width, a=1.0):
    cv.drawPath(p, paint(color, a, stroke=width))


def glow(cv, p, color, sigma, a=1.0, add=True):
    cv.drawPath(p, paint(color, a, blur=sigma, blend=skia.BlendMode.kPlus if add else None))


def circle(cv, x, y, r, color, a=1.0, **kw):
    cv.drawCircle(x, y, r, paint(color, a, **kw))


def soft_dot(cv, x, y, r, color, a=1.0):
    """A glowing point of light (additive)."""
    sh = skia.GradientShader.MakeRadial(
        (x, y), max(r, 0.1), [rgb(color, a), rgb(color, a * 0.35), rgb(color, 0)],
        [0.0, 0.35, 1.0])
    cv.drawCircle(x, y, r, paint((0, 0, 0), shader=sh, blend=skia.BlendMode.kPlus))


def linear(p0, p1, colors, stops=None):
    return skia.GradientShader.MakeLinear([p0, p1], [rgb(c, a) for c, a in colors], stops)


def radial(c, r, colors, stops=None):
    return skia.GradientShader.MakeRadial(c, r, [rgb(cc, a) for cc, a in colors], stops)


def rect(cv, x, y, w, h, color=None, a=1.0, shader=None, blend=None):
    p = paint(color or (0, 0, 0), a, shader=shader, blend=blend)
    cv.drawRect(skia.Rect.MakeXYWH(x, y, w, h), p)


def snapshot(surface):
    return surface.makeImageSnapshot().toarray(colorType=skia.kRGBA_8888_ColorType)[..., :3]


def tapered(cv, pts, w0, w1, color, a=1.0, blur=None, blend=None):
    """A brush stroke along points, tapering from w0 to w1."""
    if len(pts) < 2:
        return
    left, right = [], []
    n = len(pts)
    for i, (x, y) in enumerate(pts):
        x0, y0 = pts[max(i - 1, 0)]
        x1, y1 = pts[min(i + 1, n - 1)]
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / L, dx / L
        w = (w0 + (w1 - w0) * i / (n - 1)) / 2
        left.append((x + nx * w, y + ny * w))
        right.append((x - nx * w, y - ny * w))
    p = skia.Path()
    p.moveTo(*left[0])
    for q in left[1:]:
        p.lineTo(*q)
    for q in reversed(right):
        p.lineTo(*q)
    p.close()
    cv.drawPath(p, paint(color, a, blur=blur, blend=blend))


def bezier_pts(p0, p1, p2, p3=None, n=24):
    out = []
    for k in range(n + 1):
        u = k / n
        if p3 is None:
            x = (1 - u) ** 2 * p0[0] + 2 * (1 - u) * u * p1[0] + u * u * p2[0]
            y = (1 - u) ** 2 * p0[1] + 2 * (1 - u) * u * p1[1] + u * u * p2[1]
        else:
            x = ((1 - u) ** 3 * p0[0] + 3 * (1 - u) ** 2 * u * p1[0]
                 + 3 * (1 - u) * u * u * p2[0] + u ** 3 * p3[0])
            y = ((1 - u) ** 3 * p0[1] + 3 * (1 - u) ** 2 * u * p1[1]
                 + 3 * (1 - u) * u * u * p2[1] + u ** 3 * p3[1])
        out.append((x, y))
    return out
