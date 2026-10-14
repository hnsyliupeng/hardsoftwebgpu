// Deterministic PRNG (mulberry32). Every stochastic family takes an explicit seed so that
// evidence (parameters + seed) is sufficient to reproduce a geometry bit-for-bit.

export interface Rng {
  next(): number; // [0, 1)
  uniform(lo: number, hi: number): number;
  int(lo: number, hi: number): number; // inclusive
}

export function makeRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    uniform: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
  };
}
