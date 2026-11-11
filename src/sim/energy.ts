/**
 * Energy: each descent costs one point, and points come back over time.
 * The clock is always passed in, so this stays pure and testable.
 */

export const ENERGY_MAX = 5;
export const ENERGY_REGEN_MS = 20 * 60 * 1000;
export const ENERGY_REFILL_GEMS = 40;

/** `n` points as of time `at` (ms since epoch). Regeneration since then is not yet counted. */
export interface EnergyState {
  n: number;
  at: number;
}

export const newEnergy = (now: number): EnergyState => ({ n: ENERGY_MAX, at: now });

/** Fold the time that has passed into the stored state. */
export function settleEnergy(e: EnergyState, now: number): void {
  // A clock that went backwards earns nothing and restarts the timer.
  if (now < e.at) e.at = now;
  if (e.n >= ENERGY_MAX) {
    e.at = now;
    return;
  }
  const gained = Math.floor((now - e.at) / ENERGY_REGEN_MS);
  if (gained <= 0) return;
  e.n += gained;
  e.at += gained * ENERGY_REGEN_MS;
  if (e.n >= ENERGY_MAX) {
    e.n = ENERGY_MAX;
    e.at = now;
  }
}

/** Current points, and the wait until the next one (0 when full). */
export function energyAt(e: EnergyState, now: number): { n: number; nextMs: number } {
  const copy = { ...e };
  settleEnergy(copy, now);
  return { n: copy.n, nextMs: copy.n >= ENERGY_MAX ? 0 : ENERGY_REGEN_MS - (now - copy.at) };
}

export function spendEnergy(e: EnergyState, now: number, cost = 1): boolean {
  settleEnergy(e, now);
  if (e.n < cost) return false;
  // Dropping below full starts the regeneration timer.
  if (e.n >= ENERGY_MAX) e.at = now;
  e.n -= cost;
  return true;
}

/** Add points. Rewards may push the total past the normal cap. */
export function addEnergy(e: EnergyState, now: number, n: number): void {
  settleEnergy(e, now);
  e.n += n;
  if (e.n >= ENERGY_MAX) e.at = now;
}

export function fillEnergy(e: EnergyState, now: number): void {
  settleEnergy(e, now);
  e.n = Math.max(e.n, ENERGY_MAX);
  e.at = now;
}

/** "12:05" style countdown. */
export function formatWait(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}
