/**
 * Season pass: playing earns pass XP, XP unlocks tiers, and every tier has a
 * free reward and a premium one. Seasons are fixed four-week windows, so the
 * season a moment belongs to is computed, not stored on a server.
 */
import type { ChestId } from './orbs';

export const PASS_TIERS = 20;
export const PASS_TIER_XP = 250;
export const SEASON_MS = 28 * 24 * 60 * 60 * 1000;
/** Monday 5 January 2026, 00:00 UTC: the start of season 1. */
export const SEASON_EPOCH = Date.UTC(2026, 0, 5);

export type Track = 'free' | 'paid';

export interface Reward {
  coins?: number;
  gems?: number;
  chest?: ChestId;
}

export interface PassState {
  season: number;
  xp: number;
  premium: boolean;
  /** Tier numbers (1-based) already claimed on each track. */
  free: number[];
  paid: number[];
}

export const seasonAt = (now: number): number => Math.max(1, Math.floor((now - SEASON_EPOCH) / SEASON_MS) + 1);

export const seasonEndsIn = (now: number): number => SEASON_EPOCH + seasonAt(now) * SEASON_MS - now;

export const newPass = (now: number): PassState => ({ season: seasonAt(now), xp: 0, premium: false, free: [], paid: [] });

/** Start a fresh pass if the season has rolled over. Returns true if it did. */
export function syncPass(p: PassState, now: number): boolean {
  const season = seasonAt(now);
  if (p.season === season) return false;
  Object.assign(p, newPass(now));
  return true;
}

/** Tiers unlocked so far, 0 to PASS_TIERS. */
export const passTier = (p: PassState): number => Math.min(PASS_TIERS, Math.floor(p.xp / PASS_TIER_XP));

export function passReward(track: Track, tier: number): Reward {
  const last = tier === PASS_TIERS;
  if (track === 'free') {
    if (tier % 5 === 0) return { chest: last ? 'silver' : 'wood' };
    return tier % 2 === 1 ? { coins: 200 + 100 * tier } : { gems: 10 };
  }
  if (tier % 5 === 0) return { chest: last ? 'gold' : 'silver' };
  return tier % 2 === 1 ? { gems: 30 } : { coins: 500 + 250 * tier };
}

export function canClaim(p: PassState, track: Track, tier: number): boolean {
  if (!Number.isInteger(tier) || tier < 1 || tier > passTier(p)) return false;
  if (track === 'paid' && !p.premium) return false;
  return !p[track].includes(tier);
}

/** Rewards waiting to be collected. */
export function claimableCount(p: PassState): number {
  let n = 0;
  for (let t = 1; t <= passTier(p); t++) {
    if (canClaim(p, 'free', t)) n++;
    if (canClaim(p, 'paid', t)) n++;
  }
  return n;
}

/** Mark a tier claimed and return its reward, or null if it cannot be claimed. */
export function claimTier(p: PassState, track: Track, tier: number): Reward | null {
  if (!canClaim(p, track, tier)) return null;
  p[track].push(tier);
  return passReward(track, tier);
}

export function sanitizePass(raw: unknown, now: number): PassState {
  const fresh = newPass(now);
  if (!raw || typeof raw !== 'object') return fresh;
  const r = raw as Partial<PassState>;
  if (Number(r.season) !== fresh.season) return fresh;
  const tiers = (list: unknown): number[] =>
    Array.isArray(list) ? [...new Set(list.map(Number).filter((t) => Number.isInteger(t) && t >= 1 && t <= PASS_TIERS))] : [];
  return {
    season: fresh.season,
    xp: Math.max(0, Math.floor(Number(r.xp)) || 0),
    premium: Boolean(r.premium),
    free: tiers(r.free),
    paid: tiers(r.paid),
  };
}
