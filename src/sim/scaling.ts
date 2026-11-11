import { ipow } from './dmath';

/**
 * Every difficulty and economy curve lives here so the whole game can be
 * rebalanced from one file. Tune with `npm run sim`.
 */

export const isBossFloor = (floor: number): boolean => floor > 0 && floor % 10 === 0;

/** Up to this floor block HP grows at a steady rate; below it the dungeon steepens. */
export const DEEP_FLOOR = 20;

/**
 * Base HP of a normal block. Individual blocks vary by about ±30%.
 * Steady 25% a floor to DEEP_FLOOR, then an extra factor that itself keeps
 * growing, so permanent upgrades buy floors without ever making the tower flat.
 */
export const blockHp = (floor: number): number =>
  10 * ipow(1.25, floor - 1) * ipow(1.02, Math.max(0, floor - DEEP_FLOOR) * Math.max(0, floor - DEEP_FLOOR));

export const bossHp = (floor: number): number => blockHp(floor) * 35;

/** Total rows a (non-boss) floor sends at the player. */
export const floorRows = (floor: number): number => Math.min(12, 5 + Math.floor(floor / 3));

/** Chance that any one cell of a new row holds a block. */
export const fillChance = (floor: number): number => Math.min(0.62, 0.38 + floor * 0.012);

/** Chance that a block carries an affix. None before floor 3. */
export const affixChance = (floor: number): number =>
  floor < 3 ? 0 : Math.min(0.45, 0.1 + 0.025 * (floor - 3));

/** Chance that an affixed block carries a second one. None before floor 12. */
export const secondAffixChance = (floor: number): number => (floor < 12 ? 0 : 0.3);

/** The Shielded affix only appears from this floor. */
export const SHIELD_FLOOR = 5;

/** Chance a normal block is an elite (more HP, triple coins). */
export const eliteChance = (floor: number): number => (floor < 2 ? 0 : 0.07);

/** Damage the hero takes when a normal block reaches the bottom line. */
export const breachDamage = (floor: number): number => 8 + floor;

export const coinValue = (floor: number): number => 1 + Math.floor(floor / 4);
