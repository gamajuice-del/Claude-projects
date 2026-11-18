// =====================================================================================
//  ShellStream renderer kernel  -- one source, two targets
//
//  * NVRTC / CUDA  (Kaggle T4, sm_75): compiled at runtime by CuPy RawModule
//  * g++ / OpenMP  (any CPU)         : compiled with -DSS_CPU into a shared library
//
//  The renderer is a sphere-traced signed-distance-field city ("Neon Plaza") with
//  soft shadows, ambient occlusion, mirror/wet-floor reflections, 24 dynamic point
//  lights and volumetric neon glow.  It does NOT render "a frame".  It renders
//  *views of a shell*: arbitrary sets of (possibly asymmetric) perspective views packed
//  into an atlas, plus per-texel geometry (inverse depth + exact normal), from which a
//  topology (connectivity) map is derived.  A second-hit "background" layer is traced
//  only inside a motion-predicted disocclusion band.
// =====================================================================================

#if defined(__CUDACC__) || defined(__CUDACC_RTC__)
  #define SS_GPU 1
  #define HD __device__ __forceinline__
  #define KERNEL extern "C" __global__
#else
  #include <math.h>
  #include <string.h>
  #define HD static inline
#endif

typedef unsigned char  u8;
typedef unsigned short u16;
typedef unsigned int   u32;

// ------------------------------------------------------------------ parameter layout
#define NV_MAX        8
#define NL_MAX        24
#define P_HDR         32
#define P_VSTRIDE     24
#define P_LIGHT0      (P_HDR + NV_MAX * P_VSTRIDE)      // 224
#define P_LSTRIDE     8
#define P_TOTAL       (P_LIGHT0 + NL_MAX * P_LSTRIDE)   // 416

#define H_TIME        0
#define H_NVIEWS      1
#define H_NLIGHTS     2
#define H_FLAGS       3
#define H_ZNEAR       4
#define H_STEPS       5
#define H_BAND_DELTA  6     // expected camera translation (m) used to size the disocclusion band
#define H_SHADOW_ST   7
#define H_REFL_ST     8
#define H_MAXDIST     9
#define H_SUN         10    // 10,11,12
#define H_SPP         13    // colour samples per pixel (1, 2 or 4, rotated grid)

#define F_SHADOW      1
#define F_AO          2
#define F_REFL        4
#define F_GLOW        8

#define MODE_COLOR    1     // write rgb
#define MODE_GEO      2     // write depth code + geo (t, normal)
#define MODE_BACK     4     // background (second surface) layer, uses prepass geo
#define MODE_GEOONLY  8     // skip shading

// depth code: 0 = sky / infinity, 1 = invalid (no data), 2..65535 = inverse view-z (z_near / z)
#define DC_SKY        0
#define DC_INVALID    1

// ------------------------------------------------------------------ small vector library
struct V3 { float x, y, z; };
HD V3 v3(float x, float y, float z) { V3 r; r.x = x; r.y = y; r.z = z; return r; }
HD V3 v3s(float s) { return v3(s, s, s); }
HD V3 operator+(V3 a, V3 b) { return v3(a.x + b.x, a.y + b.y, a.z + b.z); }
HD V3 operator-(V3 a, V3 b) { return v3(a.x - b.x, a.y - b.y, a.z - b.z); }
HD V3 operator-(V3 a) { return v3(-a.x, -a.y, -a.z); }
HD V3 operator*(V3 a, float s) { return v3(a.x * s, a.y * s, a.z * s); }
HD V3 operator*(float s, V3 a) { return v3(a.x * s, a.y * s, a.z * s); }
HD V3 operator*(V3 a, V3 b) { return v3(a.x * b.x, a.y * b.y, a.z * b.z); }
HD V3 operator/(V3 a, float s) { float i = 1.0f / s; return a * i; }
HD float dot(V3 a, V3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
HD V3 cross(V3 a, V3 b) { return v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
HD float length(V3 a) { return sqrtf(dot(a, a)); }
HD V3 normalize(V3 a) { return a * (1.0f / sqrtf(fmaxf(dot(a, a), 1e-20f))); }
HD float clampf(float x, float a, float b) { return fminf(fmaxf(x, a), b); }
HD float sat(float x) { return clampf(x, 0.0f, 1.0f); }
HD float mixf(float a, float b, float t) { return a + (b - a) * t; }
HD V3 mix(V3 a, V3 b, float t) { return a + (b - a) * t; }
HD V3 vabs(V3 a) { return v3(fabsf(a.x), fabsf(a.y), fabsf(a.z)); }
HD V3 vmaxs(V3 a, float s) { return v3(fmaxf(a.x, s), fmaxf(a.y, s), fmaxf(a.z, s)); }
HD float smoothstepf(float a, float b, float x) { float t = sat((x - a) / (b - a)); return t * t * (3.0f - 2.0f * t); }
HD float fractf(float x) { return x - floorf(x); }
HD V3 reflect3(V3 i, V3 n) { return i - n * (2.0f * dot(n, i)); }

// ------------------------------------------------------------------ hashing / noise
HD u32 hash2i(int x, int y) {
    u32 h = (u32)x * 0x8da6b343u ^ (u32)y * 0xd8163841u;
    h ^= h >> 15; h *= 0x2c1b3c6du; h ^= h >> 12; h *= 0x297a2d39u; h ^= h >> 15;
    return h;
}
HD float h01(u32 h, int k) {
    h ^= (u32)k * 0x9E3779B9u; h ^= h >> 16; h *= 0x7feb352du; h ^= h >> 15; h *= 0x846ca68bu; h ^= h >> 16;
    return (float)(h & 0xFFFFFFu) * (1.0f / 16777216.0f);
}
HD float vnoise(float x, float y) {
    float fx = floorf(x), fy = floorf(y);
    int ix = (int)fx, iy = (int)fy;
    float ux = x - fx, uy = y - fy;
    ux = ux * ux * (3.0f - 2.0f * ux); uy = uy * uy * (3.0f - 2.0f * uy);
    float a = h01(hash2i(ix, iy), 7), b = h01(hash2i(ix + 1, iy), 7);
    float c = h01(hash2i(ix, iy + 1), 7), d = h01(hash2i(ix + 1, iy + 1), 7);
    return mixf(mixf(a, b, ux), mixf(c, d, ux), uy);
}

// ------------------------------------------------------------------ SDF primitives
HD float sdBox(V3 p, V3 b) {
    V3 q = vabs(p) - b;
    return length(vmaxs(q, 0.0f)) + fminf(fmaxf(q.x, fmaxf(q.y, q.z)), 0.0f);
}
HD float sdTorusZ(V3 p, float R, float r) {   // ring in the XY plane
    float qx = sqrtf(p.x * p.x + p.y * p.y) - R;
    return sqrtf(qx * qx + p.z * p.z) - r;
}
HD float sdTorusY(V3 p, float R, float r) {   // ring in the XZ plane
    float qx = sqrtf(p.x * p.x + p.z * p.z) - R;
    return sqrtf(qx * qx + p.y * p.y) - r;
}
HD float sdCylY(V3 p, float r, float h) {     // capped cylinder, centred at origin
    float dx = sqrtf(p.x * p.x + p.z * p.z) - r, dy = fabsf(p.y) - h;
    return fminf(fmaxf(dx, dy), 0.0f) + sqrtf(fmaxf(dx, 0.0f) * fmaxf(dx, 0.0f) + fmaxf(dy, 0.0f) * fmaxf(dy, 0.0f));
}

// ------------------------------------------------------------------ the world
#define CELL      14.0f
#define CITY_N    11
#define MAXHALF   5.0f
#define MAXH      44.0f
#define PLAZA     21.0f

// materials
#define M_SKY     0
#define M_FLOOR   1
#define M_BUILD   2
#define M_CHROME  3
#define M_STONE   4
#define M_METAL   5
#define M_NEON    6      // + 16*colour
#define M_ANTENNA 7

HD bool isPlazaCell(int i, int j) { return i >= -1 && i <= 1 && j >= -1 && j <= 1; }

HD void buildingDims(int i, int j, float& hx, float& hz, float& H1, float& H2, float& s2) {
    u32 h = hash2i(i, j);
    hx = 2.6f + 2.3f * h01(h, 1);
    hz = 2.6f + 2.3f * h01(h, 2);
    float r = h01(h, 3);
    float hh = 7.0f + 30.0f * r * r;
    H1 = hh * (0.45f + 0.35f * h01(h, 4));
    H2 = hh - H1;
    s2 = 0.55f + 0.35f * h01(h, 5);
}

HD V3 neonColor(int c) {
    c = c & 7;
    if (c == 0) return v3(0.10f, 0.85f, 1.00f);
    if (c == 1) return v3(1.00f, 0.15f, 0.65f);
    if (c == 2) return v3(1.00f, 0.55f, 0.10f);
    if (c == 3) return v3(0.45f, 1.00f, 0.25f);
    if (c == 4) return v3(0.65f, 0.30f, 1.00f);
    if (c == 5) return v3(1.00f, 0.90f, 0.35f);
    if (c == 6) return v3(0.20f, 0.45f, 1.00f);
    return v3(1.00f, 0.30f, 0.25f);
}

// Plaza: monument (chrome sphere, pedestal, neon ring), 4 arches with neon tubes,
// 8 pillars with neon caps, low walls (cover / parallax test objects).
template <bool M>
HD float mapPlaza(V3 p, int& m, float& glow) {
    float d = 1e9f;
    // monument
    {
        V3 q = p - v3(0.0f, 3.3f, 0.0f);
        float ds = length(q) - 2.2f;
        if (ds < d) { d = ds; if (M) m = M_CHROME; }
        float dp = sdCylY(p - v3(0.0f, 0.35f, 0.0f), 3.3f, 0.35f);
        if (dp < d) { d = dp; if (M) m = M_STONE; }
        float dr = sdTorusY(q, 3.25f, 0.10f);
        glow = fminf(glow, dr);
        if (dr < d) { d = dr; if (M) m = M_NEON + 16 * 0; }
    }
    // four arches (two along x, two along z)
    {
        V3 a = v3(p.x, p.y, fabsf(p.z) - 15.0f);      // arches at z = +-15 (ring in XY)
        float dt = sdTorusZ(a, 7.5f, 0.45f);
        dt = fmaxf(dt, -p.y);
        if (dt < d) { d = dt; if (M) m = M_METAL; }
        float dn = sdTorusZ(a - v3(0.0f, 0.0f, 0.0f), 6.95f, 0.09f);
        dn = fmaxf(dn, -p.y);
        glow = fminf(glow, dn);
        if (dn < d) { d = dn; if (M) m = M_NEON + 16 * 1; }
        V3 b = v3(fabsf(p.x) - 15.0f, p.y, p.z);      // arches at x = +-15 (ring in ZY)
        V3 bz = v3(b.z, b.y, b.x);
        float dt2 = fmaxf(sdTorusZ(bz, 7.5f, 0.45f), -p.y);
        if (dt2 < d) { d = dt2; if (M) m = M_METAL; }
        float dn2 = fmaxf(sdTorusZ(bz, 6.95f, 0.09f), -p.y);
        glow = fminf(glow, dn2);
        if (dn2 < d) { d = dn2; if (M) m = M_NEON + 16 * 0; }
    }
    // eight pillars on a circle of radius 9.5 (polar repetition)
    {
        float ang = atan2f(p.z, p.x);
        float sector = 6.2831853f / 8.0f;
        float k = floorf(ang / sector + 0.5f);
        float a2 = k * sector;
        float c = cosf(a2), s = sinf(a2);
        V3 q = v3(c * p.x + s * p.z - 9.5f, p.y, -s * p.x + c * p.z);
        float dpil = sdBox(q - v3(0.0f, 2.5f, 0.0f), v3(0.32f, 2.5f, 0.32f)) - 0.03f;
        if (dpil < d) { d = dpil; if (M) m = M_METAL; }
        float dcap = sdBox(q - v3(0.0f, 5.15f, 0.0f), v3(0.42f, 0.13f, 0.42f));
        glow = fminf(glow, dcap);
        if (dcap < d) { d = dcap; if (M) { int ci = ((int)k + 8) & 7; m = M_NEON + 16 * ci; } }
    }
    // low walls (cover)
    {
        V3 q = v3(fabsf(p.x) - 5.5f, p.y - 0.55f, fabsf(p.z) - 6.5f);
        float dw = sdBox(q, v3(1.6f, 0.55f, 0.22f)) - 0.02f;
        if (dw < d) { d = dw; if (M) m = M_STONE; }
        V3 r = v3(fabsf(p.x) - 13.0f, p.y - 0.8f, fabsf(p.z) - 4.0f);
        float dw2 = sdBox(r, v3(0.25f, 0.8f, 1.8f)) - 0.02f;
        if (dw2 < d) { d = dw2; if (M) m = M_STONE; }
    }
    return d;
}

template <bool M>
HD float mapCity(V3 p, int& m, int& ci, int& cj) {
    float fi = floorf(p.x / CELL + 0.5f), fj = floorf(p.z / CELL + 0.5f);
    int i = (int)fi, j = (int)fj;
    float qx = p.x - fi * CELL, qz = p.z - fj * CELL;
    // conservative bound to buildings in neighbouring cells
    float bound = fminf(CELL * 0.5f - fabsf(qx), CELL * 0.5f - fabsf(qz)) + (CELL * 0.5f - MAXHALF);
    bound = fmaxf(bound, p.y - MAXH);
    // outside the city footprint: distance to the city's bounding box
    float ext = (CITY_N + 0.5f) * CELL;
    float outside = fmaxf(fabsf(p.x) - ext, fabsf(p.z) - ext);
    bound = fmaxf(bound, outside);
    float d = bound;
    if (!isPlazaCell(i, j) && i >= -CITY_N && i <= CITY_N && j >= -CITY_N && j <= CITY_N) {
        float hx, hz, H1, H2, s2;
        buildingDims(i, j, hx, hz, H1, H2, s2);
        V3 q = v3(qx, p.y, qz);
        float d1 = sdBox(q - v3(0.0f, H1 * 0.5f, 0.0f), v3(hx, H1 * 0.5f, hz)) - 0.05f;
        float d2 = sdBox(q - v3(0.0f, H1 + H2 * 0.5f, 0.0f), v3(hx * s2, H2 * 0.5f, hz * s2)) - 0.05f;
        float db = fminf(d1, d2);
        float H = H1 + H2;
        if (H > 24.0f) {   // antenna on tall towers
            float da = sdCylY(q - v3(0.0f, H + 3.0f, 0.0f), 0.12f, 3.0f);
            if (da < db) { db = da; if (M) m = M_ANTENNA; }
            else if (M) m = M_BUILD;
        } else if (M) m = M_BUILD;
        if (db < d) { d = db; } else if (M) m = M_SKY;
        if (M) { ci = i; cj = j; }
    } else if (M) m = M_SKY;
    return d;
}

// full scene.  M: also return material.  G: track minimum distance to neon emitters (glow)
#if defined(SS_COUNT) && !defined(SS_GPU)
#include <omp.h>
static unsigned long long g_evals[256];
#define COUNT_EVAL() (g_evals[omp_get_thread_num() & 255]++)
extern "C" unsigned long long ss_evals() { unsigned long long s = 0; for (int i = 0; i < 256; i++) s += g_evals[i]; return s; }
extern "C" void ss_evals_reset() { memset(g_evals, 0, sizeof(g_evals)); }
#else
#define COUNT_EVAL()
#endif

template <bool M>
HD float map(V3 p, int& m, int& ci, int& cj, float& glow) {
    COUNT_EVAL();
    float d = p.y;                                   // ground
    if (M) m = M_FLOOR;
    int mc = M_SKY;
    float dc = mapCity<M>(p, mc, ci, cj);
    if (dc < d) { d = dc; if (M) m = mc; }
    if (fabsf(p.x) < PLAZA && fabsf(p.z) < PLAZA && p.y < 12.0f) {
        int mp = M_SKY;
        float dp = mapPlaza<M>(p, mp, glow);
        if (dp < d) { d = dp; if (M) m = mp; }
    } else {
        float bx = fmaxf(fabsf(p.x) - PLAZA, fabsf(p.z) - PLAZA);
        bx = fmaxf(bx, p.y - 12.0f);
        glow = fminf(glow, bx + 1.0f);
    }
    return d;
}

HD float mapD(V3 p) { int m, ci, cj; float g = 1e9f; return map<false>(p, m, ci, cj, g); }

HD V3 calcNormal(V3 p, float t) {
    float e = 0.0006f + 0.00035f * t;
    // tetrahedron technique: 4 evaluations
    V3 k0 = v3(1, -1, -1), k1 = v3(-1, -1, 1), k2 = v3(-1, 1, -1), k3 = v3(1, 1, 1);
    V3 n = k0 * mapD(p + k0 * e) + k1 * mapD(p + k1 * e) + k2 * mapD(p + k2 * e) + k3 * mapD(p + k3 * e);
    return normalize(n);
}

// sphere tracing.  returns t (or -1 on miss); accumulates neon glow if glowAcc != 0
HD float march(V3 ro, V3 rd, float tmin, float tmax, int steps, float* glowAcc) {
    float t = tmin;
    for (int i = 0; i < steps; i++) {
        V3 p = ro + rd * t;
        int m, ci, cj; float g = 1e9f;
        float d = map<false>(p, m, ci, cj, g);
        if (glowAcc) *glowAcc += expf(-g * 5.0f) * fminf(d, 0.6f);
        if (d < 0.0004f * t + 0.0015f) return t;
        t += d;
        if (t > tmax) break;
    }
    return -1.0f;
}

HD float softShadow(V3 ro, V3 rd, float tmin, float tmax, float k, int steps) {
    float res = 1.0f, t = tmin;
    for (int i = 0; i < steps; i++) {
        float h = mapD(ro + rd * t);
        res = fminf(res, k * h / t);
        t += clampf(h, 0.03f, 3.0f);
        if (res < 0.003f || t > tmax) break;
    }
    return sat(res);
}

HD float calcAO(V3 p, V3 n) {
    float occ = 0.0f, sca = 1.0f;
    for (int i = 0; i < 5; i++) {
        float h = 0.03f + 0.16f * (float)i;
        float d = mapD(p + n * h);
        occ += (h - d) * sca;
        sca *= 0.82f;
    }
    return sat(1.0f - 2.2f * occ);
}

// ------------------------------------------------------------------ lighting
HD V3 sunDir(const float* P) { return normalize(v3(P[H_SUN], P[H_SUN + 1], P[H_SUN + 2])); }

HD V3 skyColor(V3 rd, const float* P) {
    float h = rd.y;
    V3 top = v3(0.008f, 0.012f, 0.035f), hor = v3(0.30f, 0.13f, 0.22f), below = v3(0.02f, 0.02f, 0.03f);
    V3 c;
    if (h > 0.0f) c = mix(hor, top, powf(fminf(h * 2.0f, 1.0f), 0.55f));
    else c = mix(hor, below, fminf(-h * 6.0f, 1.0f));
    V3 sd = sunDir(P);
    float mu = fmaxf(dot(rd, sd), 0.0f);
    c = c + v3(0.95f, 0.97f, 1.0f) * (smoothstepf(0.99930f, 0.99955f, mu) * 2.5f);
    c = c + v3(0.18f, 0.22f, 0.40f) * (powf(mu, 48.0f) * 0.6f);
    return c;
}

struct Mat { V3 alb; V3 emis; float rough; float refl; };

HD Mat material(V3 p, V3 n, int m, int ci, int cj, const float* P) {
    Mat r; r.alb = v3s(0.5f); r.emis = v3s(0.0f); r.rough = 0.6f; r.refl = 0.0f;
    float time = P[H_TIME];
    if (m == M_FLOOR) {
        bool plaza = fabsf(p.x) < PLAZA && fabsf(p.z) < PLAZA;
        if (plaza) {
            float tx = fractf(p.x * 0.5f), tz = fractf(p.z * 0.5f);
            float grout = (tx < 0.03f || tz < 0.03f) ? 0.55f : 1.0f;
            u32 th = hash2i((int)floorf(p.x * 0.5f), (int)floorf(p.z * 0.5f));
            float v = 0.85f + 0.3f * h01(th, 3);
            r.alb = v3(0.20f, 0.20f, 0.22f) * (grout * v);
            float rr = length(v3(p.x, 0.0f, p.z));
            float ringl = smoothstepf(0.08f, 0.0f, fabsf(rr - 12.5f));     // inlaid light ring
            r.emis = v3(0.1f, 0.7f, 1.0f) * (ringl * 1.6f);
            r.refl = 0.35f; r.rough = 0.25f;
        } else {
            r.alb = v3(0.055f, 0.055f, 0.065f);
            // dashed lane lines on street centres
            float sx = fabsf(fractf(p.x / CELL) - 0.5f) * CELL;   // distance to street centre line x = (i+.5)CELL
            float sz = fabsf(fractf(p.z / CELL) - 0.5f) * CELL;
            float dashz = fractf(p.z * 0.25f) < 0.5f ? 1.0f : 0.0f;
            float dashx = fractf(p.x * 0.25f) < 0.5f ? 1.0f : 0.0f;
            float line = fmaxf((sx < 0.08f ? dashz : 0.0f), (sz < 0.08f ? dashx : 0.0f));
            r.alb = mix(r.alb, v3(0.55f, 0.45f, 0.12f), line);
            float w = vnoise(p.x * 0.35f, p.z * 0.35f) * 0.65f + vnoise(p.x * 1.3f, p.z * 1.3f) * 0.35f;
            float wet = smoothstepf(0.48f, 0.56f, w);
            r.refl = mixf(0.08f, 0.75f, wet);
            r.rough = mixf(0.6f, 0.03f, wet);
            r.alb = r.alb * mixf(1.0f, 0.5f, wet);
        }
    } else if (m == M_BUILD) {
        u32 bh = hash2i(ci, cj);
        V3 base = mix(v3(0.10f, 0.11f, 0.14f), v3(0.20f, 0.18f, 0.17f), h01(bh, 9));
        r.alb = base; r.rough = 0.7f; r.refl = 0.0f;
        float u = fabsf(n.x) > 0.5f ? p.z : p.x;
        float v = p.y;
        if (fabsf(n.y) < 0.5f) {
            float fx = u / 2.2f, fy = v / 3.3f;
            int wx = (int)floorf(fx), wy = (int)floorf(fy);
            float lx = fx - floorf(fx), ly = fy - floorf(fy);
            bool win = lx > 0.14f && lx < 0.86f && ly > 0.22f && ly < 0.82f && v > 1.2f;
            u32 wh = hash2i(wx * 131 + ci * 7, wy * 17 + cj * 13);
            if (win) {
                float lit = h01(wh, 11);
                if (lit < 0.34f) {
                    V3 wc = h01(wh, 12) < 0.6f ? v3(1.0f, 0.72f, 0.42f) : v3(0.55f, 0.80f, 1.0f);
                    r.emis = wc * (0.6f + 1.4f * h01(wh, 13));
                    r.alb = v3s(0.02f);
                } else {
                    r.alb = v3(0.03f, 0.035f, 0.05f); r.refl = 0.35f; r.rough = 0.08f;
                }
            }
            int band = 1 + (int)(h01(bh, 14) * 4.0f);
            if (wy == band && ly < 0.12f) {
                float pulse = 0.85f + 0.15f * sinf(time * 1.5f + (float)ci);
                r.emis = neonColor((int)(h01(bh, 15) * 8.0f)) * (3.0f * pulse);
                r.alb = v3s(0.02f);
            }
        }
    } else if (m == M_CHROME) {
        r.alb = v3(0.75f, 0.78f, 0.82f); r.refl = 0.85f; r.rough = 0.02f;
    } else if (m == M_STONE) {
        r.alb = v3(0.28f, 0.27f, 0.26f); r.rough = 0.85f;
    } else if (m == M_METAL) {
        r.alb = v3(0.35f, 0.37f, 0.42f); r.refl = 0.3f; r.rough = 0.25f;
    } else if (m == M_ANTENNA) {
        r.alb = v3s(0.08f); r.rough = 0.5f;
        float blink = sinf(time * 3.0f + (float)(ci * 3 + cj)) > 0.2f ? 1.0f : 0.15f;
        float H1, H2, hx, hz, s2; buildingDims(ci, cj, hx, hz, H1, H2, s2);
        if (p.y > H1 + H2 + 5.4f) r.emis = v3(1.0f, 0.1f, 0.05f) * (6.0f * blink);   // tip light
    } else if (m >= M_NEON) {
        int c = (m - M_NEON) / 16;
        float pulse = 0.9f + 0.1f * sinf(time * 2.0f + (float)c * 1.7f);
        r.emis = neonColor(c) * (4.0f * pulse);
        r.alb = v3s(0.05f);
    }
    return r;
}

// direct + ambient lighting for a surface point.  full = primary-quality shading
HD V3 lightSurface(V3 p, V3 n, V3 rd, const Mat& mt, const float* P, bool full) {
    int flags = (int)P[H_FLAGS];
    V3 col = v3s(0.0f);
    V3 sd = sunDir(P);
    float ndl = dot(n, sd);
    // moon
    if (ndl > 0.0f) {
        float sh = 1.0f;
        if (full && (flags & F_SHADOW)) sh = softShadow(p + n * 0.01f, sd, 0.02f, 80.0f, 10.0f, (int)P[H_SHADOW_ST]);
        V3 h = normalize(sd - rd);
        float spec = powf(sat(dot(n, h)), mixf(256.0f, 8.0f, mt.rough)) * (1.0f - mt.rough) * 2.0f;
        col = col + v3(0.34f, 0.40f, 0.58f) * (ndl * sh) * (mt.alb + v3s(spec));
    }
    // hemispherical ambient
    float occ = (full && (flags & F_AO)) ? calcAO(p, n) : 1.0f;
    V3 amb = mix(v3(0.05f, 0.035f, 0.05f), v3(0.07f, 0.08f, 0.14f), n.y * 0.5f + 0.5f);
    col = col + mt.alb * amb * occ;
    // point lights (static plaza lights + client-side dynamic objects)
    int nl = (int)P[H_NLIGHTS];
    for (int i = 0; i < nl; i++) {
        const float* L = P + P_LIGHT0 + i * P_LSTRIDE;
        V3 lp = v3(L[0], L[1], L[2]);
        V3 lc = v3(L[3], L[4], L[5]);
        float rad = L[6];
        V3 ld = lp - p;
        float d2 = dot(ld, ld);
        if (d2 > rad * rad) continue;
        float d = sqrtf(d2);
        V3 l = ld / fmaxf(d, 1e-4f);
        float nd = dot(n, l);
        if (nd <= 0.0f) continue;
        float x = d / rad; float win = sat(1.0f - x * x * x * x); win *= win;
        float att = win / (1.0f + d2);
        V3 h = normalize(l - rd);
        float spec = powf(sat(dot(n, h)), mixf(200.0f, 8.0f, mt.rough)) * (1.0f - mt.rough) * 3.0f;
        col = col + lc * (nd * att) * (mt.alb + v3s(spec));
    }
    col = col + mt.emis * occ;
    return col;
}

HD V3 applyFog(V3 col, V3 rd, float t, const float* P) {
    float fogAmt = 1.0f - expf(-t * 0.0065f);
    V3 fc = mix(v3(0.09f, 0.05f, 0.10f), v3(0.30f, 0.13f, 0.22f), sat(1.0f - fabsf(rd.y) * 4.0f));
    return mix(col, fc, fogAmt);
}

// shade a hit point (primary quality incl. one reflection bounce)
HD V3 shadeHit(V3 ro, V3 rd, float t, const float* P, V3* nOut) {
    V3 p = ro + rd * t;
    int m = M_SKY, ci = 0, cj = 0; float g = 1e9f;
    map<true>(p, m, ci, cj, g);
    V3 n = calcNormal(p, t);
    if (nOut) *nOut = n;
    Mat mt = material(p, n, m, ci, cj, P);
    V3 col = lightSurface(p, n, rd, mt, P, true);
    int flags = (int)P[H_FLAGS];
    if ((flags & F_REFL) && mt.refl > 0.02f) {
        V3 rr = reflect3(rd, n);
        float fres = mt.refl * (0.25f + 0.75f * powf(1.0f - sat(dot(-rd, n)), 3.0f));
        fres = fminf(fres + mt.refl * 0.3f, 1.0f);
        float t2 = march(p + n * 0.02f, rr, 0.02f, 160.0f, (int)P[H_REFL_ST], 0);
        V3 rc;
        if (t2 > 0.0f) {
            V3 p2 = p + n * 0.02f + rr * t2;
            int m2 = M_SKY, ci2 = 0, cj2 = 0; float g2 = 1e9f;
            map<true>(p2, m2, ci2, cj2, g2);
            V3 n2 = calcNormal(p2, t + t2);
            Mat mt2 = material(p2, n2, m2, ci2, cj2, P);
            rc = lightSurface(p2, n2, rr, mt2, P, false);
            rc = applyFog(rc, rr, t2, P);
        } else {
            rc = skyColor(rr, P);
        }
        // rough reflections are dimmer / blurrier: approximate by attenuation
        col = mix(col, rc * mix(v3s(1.0f), mt.alb * 1.5f + v3s(0.4f), mt.refl > 0.8f ? 0.3f : 0.0f), fres * (1.0f - 0.7f * mt.rough));
    }
    return applyFog(col, rd, t, P);
}

HD V3 tonemap(V3 c) {   // ACES (Narkowicz) + gamma
    V3 r;
    float a = 2.51f, b = 0.03f, cc = 2.43f, d = 0.59f, e = 0.14f;
    r.x = sat((c.x * (a * c.x + b)) / (c.x * (cc * c.x + d) + e));
    r.y = sat((c.y * (a * c.y + b)) / (c.y * (cc * c.y + d) + e));
    r.z = sat((c.z * (a * c.z + b)) / (c.z * (cc * c.z + d) + e));
    r.x = powf(r.x, 1.0f / 2.2f); r.y = powf(r.y, 1.0f / 2.2f); r.z = powf(r.z, 1.0f / 2.2f);
    return r;
}

// ------------------------------------------------------------------ views
struct View { V3 o, r, u, f; float l, rr, b, t; int x0, y0, w, h; };

HD View loadView(const float* P, int k) {
    const float* V = P + P_HDR + k * P_VSTRIDE;
    View v;
    v.o = v3(V[0], V[1], V[2]); v.r = v3(V[3], V[4], V[5]); v.u = v3(V[6], V[7], V[8]); v.f = v3(V[9], V[10], V[11]);
    v.l = V[12]; v.rr = V[13]; v.b = V[14]; v.t = V[15];
    v.x0 = (int)V[16]; v.y0 = (int)V[17]; v.w = (int)V[18]; v.h = (int)V[19];
    return v;
}
HD int findView(const float* P, int x, int y, View& v) {
    int nv = (int)P[H_NVIEWS];
    for (int k = 0; k < nv; k++) {
        v = loadView(P, k);
        if (x >= v.x0 && x < v.x0 + v.w && y >= v.y0 && y < v.y0 + v.h) return k;
    }
    return -1;
}
// un-normalised ray direction through texel centre (x,y) of view v (in tan space: dot(dir, f) == 1)
HD V3 viewRay(const View& v, float x, float y) {
    float sx = (x - (float)v.x0 + 0.5f) / (float)v.w;          // 0..1 left->right
    float sy = (y - (float)v.y0 + 0.5f) / (float)v.h;          // 0..1 top->bottom
    float tx = v.l + (v.rr - v.l) * sx;
    float ty = v.t + (v.b - v.t) * sy;
    return v.f + v.r * tx + v.u * ty;
}

// rotated-grid sub-pixel positions for 1 / 2 / 4 samples per pixel
HD void subpixel(int spp, int s, float& ox, float& oy) {
    if (spp > 4) {           // progressive refinement: R2 low-discrepancy sequence
        ox = fractf(0.5f + (float)s * 0.75487766624f);
        oy = fractf(0.5f + (float)s * 0.56984029099f);
    } else if (spp == 4) {   // RGSS: (3/8,1/8) (7/8,3/8) (1/8,5/8) (5/8,7/8) -- arithmetic, no local-memory table
        int k = s & 3;
        oy = 0.125f + 0.25f * (float)k;
        ox = k == 0 ? 0.375f : (k == 1 ? 0.875f : (k == 2 ? 0.125f : 0.625f));
    } else if (spp == 2) {
        ox = s ? 0.75f : 0.25f; oy = s ? 0.75f : 0.25f;
    } else { ox = 0.5f; oy = 0.5f; }
}

HD u16 encodeDepth(float z, float zn) {
    float u = zn / fmaxf(z, zn);
    int c = 2 + (int)(u * 65533.0f + 0.5f);
    return (u16)(c > 65535 ? 65535 : c);
}
HD float decodeU(u16 c) { return c < 2 ? 0.0f : (float)(c - 2) * (1.0f / 65533.0f); }   // = zn / z

// background-layer decision: should texel (x,y) carry the 2nd surface (2), the 1st (1) or nothing (0)?
HD int bandDecision(const float* P, const u16* pre, int W, int H, int x, int y, const View& v) {
    u16 c0 = pre[y * W + x];
    if (c0 == DC_INVALID) return 0;
    float u0 = decodeU(c0);
    float zn = P[H_ZNEAR];
    float delta = P[H_BAND_DELTA];
    float fpx = (float)v.w / (v.rr - v.l);          // pixels per unit tan
    // 8 directions x 13 geometrically growing radii (1,2,3,4,5,7,9,11,15,19,25,33,42 texels); computed, not tabled
    const int NR = 13;
    bool near1 = false;
    for (int dir = 0; dir < 8; dir++) {
        int dxi = (dir == 0 || dir == 1 || dir == 7) ? 1 : ((dir == 3 || dir == 4 || dir == 5) ? -1 : 0);
        int dyi = (dir == 1 || dir == 2 || dir == 3) ? 1 : ((dir == 5 || dir == 6 || dir == 7) ? -1 : 0);
        float inv = (dxi != 0 && dyi != 0) ? 0.70710678f : 1.0f;
        for (int k = 0; k < NR; k++) {
            float rad = k < 4 ? (float)(k + 1) : floorf(4.0f * powf(1.3f, (float)(k - 3)) + 0.5f);
            int qx = x + (int)floorf(rad * (float)dxi * inv + 0.5f);
            int qy = y + (int)floorf(rad * (float)dyi * inv + 0.5f);
            if (qx < v.x0 || qx >= v.x0 + v.w || qy < v.y0 || qy >= v.y0 + v.h) break;
            u16 cq = pre[qy * W + qx];
            if (cq == DC_INVALID) continue;
            float uq = decodeU(cq);
            float dist = rad;
            if (uq < u0 * 0.92f - 1e-5f) {
                // q is clearly farther: a disocclusion opens next to p, of width f * delta * (1/z_p - 1/z_q)
                float need = fpx * delta * (u0 - uq) / zn + 2.0f;
                if (dist <= need) return 2;
            } else if (uq > u0 * 1.08f + 1e-5f && dist <= 2.5f) {
                near1 = true;                   // p is background right next to a foreground edge
            }
        }
    }
    return near1 ? 1 : 0;
}

// ------------------------------------------------------------------ per-pixel entry
HD void renderPixel(const float* P, u8* rgb, u16* dcode, float* geo, const float* preGeo, const u16* preCode,
                    int W, int H, int mode, int x, int y) {
    int idx = y * W + x;
    View v;
    int k = findView(P, x, y, v);
    if (k < 0) {
        if (mode & MODE_COLOR) { rgb[idx * 3 + 0] = 0; rgb[idx * 3 + 1] = 0; rgb[idx * 3 + 2] = 0; }
        if (mode & MODE_GEO) { dcode[idx] = DC_INVALID; geo[idx * 4 + 0] = -1.0f; }
        return;
    }
    V3 dirU = viewRay(v, (float)x, (float)y);        // dot(dirU, f) == 1  ->  view-z = t / |dirU|
    float invLen = 1.0f / length(dirU);
    V3 rd = dirU * invLen;
    V3 ro = v.o;
    float zn = P[H_ZNEAR];
    float maxd = P[H_MAXDIST];
    int steps = (int)P[H_STEPS];
    int flags = (int)P[H_FLAGS];

    float t = -1.0f;
    float glowAcc = 0.0f;
    bool valid = true;

    // ---- plain colour passes: supersampled (rotated grid), geometry is not written here
    if ((mode & MODE_COLOR) && !(mode & (MODE_BACK | MODE_GEO))) {
        int spp = (int)P[H_SPP]; if (spp < 1) spp = 1;
        V3 acc = v3s(0.0f);
        for (int si = 0; si < spp; si++) {
            float ox, oy; subpixel(spp, si, ox, oy);
            V3 rds = normalize(viewRay(v, (float)x + ox - 0.5f, (float)y + oy - 0.5f));
            float g = 0.0f;
            float ts = march(ro, rds, zn, maxd, steps, (flags & F_GLOW) ? &g : 0);
            V3 c = ts > 0.0f ? shadeHit(ro, rds, ts, P, 0) : applyFog(skyColor(rds, P), rds, 40.0f, P);
            c = c + v3(0.35f, 0.55f, 1.0f) * (g * 0.05f) + v3(1.0f, 0.3f, 0.7f) * (g * 0.02f);
            acc = acc + tonemap(c);
        }
        acc = acc * (1.0f / (float)spp);
        rgb[idx * 3 + 0] = (u8)(acc.x * 255.0f + 0.5f);
        rgb[idx * 3 + 1] = (u8)(acc.y * 255.0f + 0.5f);
        rgb[idx * 3 + 2] = (u8)(acc.z * 255.0f + 0.5f);
        return;
    }

    if (mode & MODE_BACK) {
        int dec = bandDecision(P, preCode, W, H, x, y, v);
        float t1 = preGeo[idx * 4 + 0];
        if (dec == 0) { valid = false; }
        else if (dec == 1) { t = t1; }
        else {
            if (t1 <= 0.0f) { valid = false; }
            else {
                V3 p1 = ro + rd * t1;
                if (p1.y < 0.01f) valid = false;    // the ground has nothing behind it
                else {
                    // walk through the occluder ...
                    float tt = t1 + 0.01f + 0.002f * t1;
                    bool exited = false;
                    for (int i = 0; i < 96; i++) {
                        float d = mapD(ro + rd * tt);
                        if (d > 0.002f) { exited = true; break; }
                        tt += fmaxf(-d, 0.01f + 0.001f * tt);
                        if (tt > t1 + 60.0f) break;
                    }
                    // ... and find the surface behind it
                    if (exited) t = march(ro, rd, tt + 0.01f, maxd, steps, 0);
                    else valid = false;
                }
            }
        }
    } else {
        t = march(ro, rd, zn, maxd, steps, (flags & F_GLOW) && !(mode & MODE_GEOONLY) ? &glowAcc : 0);
    }

    V3 n = v3(0, 1, 0);
    V3 col = v3s(0.0f);
    if (!valid) {
        col = v3s(0.0f);
    } else if (t > 0.0f) {
        if (!(mode & MODE_GEOONLY) && (mode & MODE_COLOR)) col = shadeHit(ro, rd, t, P, &n);
        else n = calcNormal(ro + rd * t, t);
    } else {
        if (mode & MODE_COLOR) col = applyFog(skyColor(rd, P), rd, 40.0f, P);
    }
    if (mode & MODE_COLOR) {
        col = col + v3(0.35f, 0.55f, 1.0f) * (glowAcc * 0.05f) + v3(1.0f, 0.3f, 0.7f) * (glowAcc * 0.02f);
        V3 tm = tonemap(col);
        rgb[idx * 3 + 0] = (u8)(tm.x * 255.0f + 0.5f);
        rgb[idx * 3 + 1] = (u8)(tm.y * 255.0f + 0.5f);
        rgb[idx * 3 + 2] = (u8)(tm.z * 255.0f + 0.5f);
        if (!valid) { rgb[idx * 3 + 0] = 0; rgb[idx * 3 + 1] = 0; rgb[idx * 3 + 2] = 0; }
    }
    if (mode & MODE_GEO) {
        if (!valid) { dcode[idx] = DC_INVALID; geo[idx * 4 + 0] = -1.0f; }
        else if (t > 0.0f) {
            dcode[idx] = encodeDepth(t * invLen, zn);
            geo[idx * 4 + 0] = t; geo[idx * 4 + 1] = n.x; geo[idx * 4 + 2] = n.y; geo[idx * 4 + 3] = n.z;
        } else {
            dcode[idx] = DC_SKY;
            geo[idx * 4 + 0] = 0.0f;
        }
    }
}

// ------------------------------------------------------------------ topology (connectivity) map
// bit 0: texel connected to right neighbour, bit 1: to lower neighbour, bit 2: (x+1,y) <-> (x,y+1)
HD int connected(const View& v, const float* geo, int W, int ia, int ib, float xa, float ya, float xb, float yb) {
    float ta = geo[ia * 4], tb = geo[ib * 4];
    if (ta < 0.0f || tb < 0.0f) return 0;            // invalid
    if (ta == 0.0f && tb == 0.0f) return 1;          // sky - sky
    if (ta == 0.0f || tb == 0.0f) return 0;          // sky - surface
    V3 da = normalize(viewRay(v, xa, ya)), db = normalize(viewRay(v, xb, yb));
    V3 pa = v.o + da * ta, pb = v.o + db * tb;
    V3 na = v3(geo[ia * 4 + 1], geo[ia * 4 + 2], geo[ia * 4 + 3]);
    V3 nb = v3(geo[ib * 4 + 1], geo[ib * 4 + 2], geo[ib * 4 + 3]);
    V3 dd = pb - pa;
    float len = length(dd);
    float pix = (v.rr - v.l) / (float)v.w;           // texel size in tan units
    float foot = fmaxf(ta, tb) * pix;
    if (len < 2.5f * foot) return 1;                 // creases, tiny steps
    float pl = fmaxf(fabsf(dot(dd, na)), fabsf(dot(dd, nb)));
    return pl < 0.2f * len ? 1 : 0;                  // same (locally planar) surface
}

HD void connPixel(const float* P, const float* geo, u8* bits, int W, int H, int x, int y) {
    View v;
    int k = findView(P, x, y, v);
    u8 b = 0;
    if (k >= 0) {
        int i = y * W + x;
        bool hasR = x + 1 < v.x0 + v.w, hasD = y + 1 < v.y0 + v.h;
        if (hasR && connected(v, geo, W, i, i + 1, (float)x, (float)y, (float)(x + 1), (float)y)) b |= 1;
        if (hasD && connected(v, geo, W, i, i + W, (float)x, (float)y, (float)x, (float)(y + 1))) b |= 2;
        if (hasR && hasD && connected(v, geo, W, i + 1, i + W, (float)(x + 1), (float)y, (float)x, (float)(y + 1))) b |= 4;
    }
    bits[y * W + x] = b;
}

// ------------------------------------------------------------------ background-band fill
// Unused (invalid) background texels get the mean colour of valid texels within 4 texels (fog colour if none),
// so JPEG's 8x8 / 16x16 blocks do not bleed black into the valid band texels next to them.
HD void fillPixel(const u8* src, u8* dst, const u16* code, int W, int H, int x, int y) {
    int i = y * W + x;
    if (code[i] != DC_INVALID) { dst[i * 3] = src[i * 3]; dst[i * 3 + 1] = src[i * 3 + 1]; dst[i * 3 + 2] = src[i * 3 + 2]; return; }
    float r = 0.0f, g = 0.0f, b = 0.0f, n = 0.0f;
    for (int dy = -4; dy <= 4; dy++) {
        int yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (int dx = -4; dx <= 4; dx++) {
            int xx = x + dx; if (xx < 0 || xx >= W) continue;
            int q = yy * W + xx;
            if (code[q] == DC_INVALID) continue;
            r += src[q * 3]; g += src[q * 3 + 1]; b += src[q * 3 + 2]; n += 1.0f;
        }
    }
    if (n > 0.0f) { dst[i * 3] = (u8)(r / n + 0.5f); dst[i * 3 + 1] = (u8)(g / n + 0.5f); dst[i * 3 + 2] = (u8)(b / n + 0.5f); }
    else { dst[i * 3] = 46; dst[i * 3 + 1] = 30; dst[i * 3 + 2] = 52; }
}

// ------------------------------------------------------------------ collision brick
// signed distance on a regular grid around the player, quantised to centimetres in int8
HD void brickCell(const float* B, signed char* out, int i) {
    int nx = (int)B[4], ny = (int)B[5], nz = (int)B[6];
    int ix = i % nx, iy = (i / nx) % ny, iz = i / (nx * ny);
    if (iz >= nz) return;
    V3 p = v3(B[0] + ix * B[3], B[1] + iy * B[3], B[2] + iz * B[3]);
    float d = mapD(p);
    int q = (int)floorf(d * 100.0f + 0.5f);
    out[i] = (signed char)(q > 127 ? 127 : (q < -127 ? -127 : q));
}

// ------------------------------------------------------------------ entry points
#ifdef SS_GPU
KERNEL void ss_render(const float* P, u8* rgb, u16* dcode, float* geo, const float* preGeo, const u16* preCode,
                      int W, int H, int mode, int y0, int y1) {
    int x = blockIdx.x * blockDim.x + threadIdx.x;
    int y = y0 + blockIdx.y * blockDim.y + threadIdx.y;
    if (x >= W || y >= y1) return;
    renderPixel(P, rgb, dcode, geo, preGeo, preCode, W, H, mode, x, y);
}
KERNEL void ss_conn(const float* P, const float* geo, u8* bits, int W, int H) {
    int x = blockIdx.x * blockDim.x + threadIdx.x;
    int y = blockIdx.y * blockDim.y + threadIdx.y;
    if (x >= W || y >= H) return;
    connPixel(P, geo, bits, W, H, x, y);
}
KERNEL void ss_mapbench(const float* pts, float* out, int n) {   // used only for cost modelling
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i >= n) return;
    out[i] = mapD(v3(pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]));
}
KERNEL void ss_fill(const u8* src, u8* dst, const u16* code, int W, int H) {
    int x = blockIdx.x * blockDim.x + threadIdx.x;
    int y = blockIdx.y * blockDim.y + threadIdx.y;
    if (x >= W || y >= H) return;
    fillPixel(src, dst, code, W, H, x, y);
}
KERNEL void ss_brick(const float* P, const float* B, signed char* out, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i >= n) return;
    brickCell(B, out, i);
}
#else
extern "C" void ss_render(const float* P, u8* rgb, u16* dcode, float* geo, const float* preGeo, const u16* preCode,
                          int W, int H, int mode, int y0, int y1) {
    #pragma omp parallel for schedule(dynamic, 1)
    for (int y = y0; y < y1; y++)
        for (int x = 0; x < W; x++)
            renderPixel(P, rgb, dcode, geo, preGeo, preCode, W, H, mode, x, y);
}
extern "C" void ss_conn(const float* P, const float* geo, u8* bits, int W, int H) {
    #pragma omp parallel for schedule(static)
    for (int y = 0; y < H; y++)
        for (int x = 0; x < W; x++)
            connPixel(P, geo, bits, W, H, x, y);
}
extern "C" void ss_fill(const u8* src, u8* dst, const u16* code, int W, int H) {
    #pragma omp parallel for schedule(static)
    for (int y = 0; y < H; y++)
        for (int x = 0; x < W; x++) fillPixel(src, dst, code, W, H, x, y);
}
extern "C" void ss_brick(const float* P, const float* B, signed char* out, int n) {
    #pragma omp parallel for schedule(static)
    for (int i = 0; i < n; i++) brickCell(B, out, i);
}
extern "C" float ss_sdf(float x, float y, float z) { return mapD(v3(x, y, z)); }
#endif
