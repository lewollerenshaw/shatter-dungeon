/**
 * Seeded PRNG (mulberry32). The state lives on the run state object so the
 * whole simulation can be cloned and replayed deterministically.
 */
export interface RngHolder {
  rng: number;
}

export function rand(h: RngHolder): number {
  h.rng = (h.rng + 0x6d2b79f5) | 0;
  let t = h.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const randRange = (h: RngHolder, lo: number, hi: number): number => lo + rand(h) * (hi - lo);

export const randInt = (h: RngHolder, n: number): number => Math.floor(rand(h) * n);

export function pick<T>(h: RngHolder, arr: readonly T[]): T {
  return arr[randInt(h, arr.length)];
}

export function shuffle<T>(h: RngHolder, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(h, i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}
