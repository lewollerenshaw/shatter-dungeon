/**
 * Every difficulty and economy curve lives here so the whole game can be
 * rebalanced from one file. Tune with `npm run sim`.
 */

export const isBossFloor = (floor: number): boolean => floor > 0 && floor % 10 === 0;

/** Base HP of a normal block. Individual blocks vary by about ±30%. */
export const blockHp = (floor: number): number => 10 * Math.pow(1.25, floor - 1);

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
