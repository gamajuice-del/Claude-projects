// Save / load: the entire simulation state round-trips through JSON (typed arrays as base64).
// A loaded world continues exactly as the original would have.
import { RNG } from './rng';
import { Sim } from './types';
import { newRuntime, SIM_VERSION } from './sim';
import { recomputeMods } from './tech';

const TYPES: Record<string, any> = { F32: Float32Array, U8: Uint8Array, I8: Int8Array, U16: Uint16Array, I16: Int16Array, I32: Int32Array };

function b64encode(bytes: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH) as unknown as number[]);
  return btoa(s);
}
function b64decode(str: string): Uint8Array {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function enc(v: any): any {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object') return v;
  if (v instanceof RNG) return { __t: 'RNG', s: v.s };
  if (ArrayBuffer.isView(v)) {
    for (const k in TYPES) {
      if (v instanceof TYPES[k]) {
        const ta = v as unknown as { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
        return { __t: k, b: b64encode(new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength)) };
      }
    }
    throw new Error('unsupported typed array');
  }
  if (v instanceof Map) {
    const e: any[] = [];
    for (const [k, val] of v) e.push([k, enc(val)]);
    return { __t: 'M', e };
  }
  if (Array.isArray(v)) {
    const out = new Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = enc(v[i]);
    return out;
  }
  const o: any = {};
  for (const k in v) o[k] = enc(v[k]);
  return o;
}

function dec(v: any): any {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) v[i] = dec(v[i]);
    return v;
  }
  const t = v.__t;
  if (t) {
    if (t === 'RNG') {
      const r = new RNG(0);
      r.s = v.s;
      return r;
    }
    if (t === 'M') {
      const m = new Map();
      for (const [k, val] of v.e) m.set(k, dec(val));
      return m;
    }
    const C = TYPES[t];
    const bytes = b64decode(v.b);
    return new C(bytes.buffer, 0, bytes.byteLength / C.BYTES_PER_ELEMENT);
  }
  for (const k in v) v[k] = dec(v[k]);
  return v;
}

export function serialize(sim: Sim): string {
  const { rt, ...rest } = sim;
  void rt;
  return JSON.stringify({ format: 'genesis-save', version: SIM_VERSION, data: enc(rest) });
}

export function deserialize(json: string): Sim {
  const raw = JSON.parse(json);
  if (!raw || raw.format !== 'genesis-save') throw new Error('This file is not a Genesis world.');
  if (raw.version !== SIM_VERSION) throw new Error(`This world was saved by a different version (${raw.version}).`);
  const sim = dec(raw.data) as Sim;
  sim.rt = newRuntime(sim.world);
  for (const c of sim.civs.values()) recomputeMods(c);
  return sim;
}

/** order-sensitive digest of the whole state, for verifying determinism and save fidelity */
export function stateHash(sim: Sim): string {
  let h = 2166136261 >>> 0;
  const mix = (n: number) => {
    h ^= n & 0xffff;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= (n >>> 16) & 0xffff;
    h = Math.imul(h, 16777619) >>> 0;
  };
  const f = (x: number) => mix(Math.round(x * 1000) | 0);
  const w = sim.world;
  for (let i = 0; i < w.n; i += 1) {
    mix(w.water[i] | (w.imp[i] << 4) | (w.road[i] << 8) | (w.fire[i] << 12));
    mix(w.owner[i]);
    f(w.elev[i]);
    f(w.veg[i]);
    f(w.forest[i]);
    f(w.moist[i]);
    f(w.fert[i]);
    mix(w.resAmt[i]);
  }
  mix(sim.tick);
  mix(sim.rng.s);
  mix(sim.nextId);
  for (const p of sim.people.values()) {
    mix(p.id);
    mix(p.home);
    mix(p.job);
    f(p.wealth);
    f(p.fed);
    f(p.health);
    f(p.happy);
    f(p.loyalty);
    mix(p.spouse);
    mix(p.kids.length);
  }
  for (const s of sim.settlements.values()) {
    mix(s.id);
    mix(s.civ);
    mix(s.people.length);
    for (const v of s.stock) f(v);
    for (const v of s.price) f(v);
    f(s.unrest);
  }
  for (const c of sim.civs.values()) {
    mix(c.id);
    mix(c.gov);
    f(c.treasury);
    mix(c.ruler);
    for (const v of c.tech) mix(v);
    for (const v of c.research) f(v);
  }
  for (const hd of sim.herds.values()) {
    mix(hd.id);
    mix(hd.n);
    f(hd.x);
    f(hd.y);
  }
  for (const a of sim.armies.values()) {
    mix(a.id);
    mix(a.soldiers.length);
    f(a.x);
    f(a.y);
    f(a.morale);
  }
  for (const pt of sim.parties.values()) {
    mix(pt.id);
    mix(pt.pi);
    f(pt.qty);
  }
  mix(sim.history.length);
  f(sim.climate.tempOffset);
  f(sim.climate.co2);
  return h.toString(16);
}
