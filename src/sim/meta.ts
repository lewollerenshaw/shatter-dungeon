/**
 * Permanent progression: forge and tavern upgrades bought with coins, and a
 * talent tree fed by hero levels. Pure data and arithmetic, like the rest of
 * the simulation, so the balance bot can play with any profile.
 */
import { MAX_ORB_LEVEL, ORB_TYPES, orbPower } from './orbs';
import type { Element } from './types';

/** The part of a profile that changes how a run plays. Plain data: a run keeps its own copy. */
export interface MetaState {
  upgrades: Record<string, number>;
  talents: Record<string, number>;
  /** Level of the best orb held of each element (see orbs.ts). Missing means level 1. */
  orbs?: Partial<Record<Element, number>>;
}

/** What the purchase helpers need from a save file. */
export interface Profile extends MetaState {
  coins: number;
  xp: number;
}

export const NO_META: MetaState = Object.freeze({ upgrades: Object.freeze({}), talents: Object.freeze({}) });

export type MetaIcon = Element | 'power' | 'crit' | 'life' | 'gold' | 'orb';
export type ShopId = 'forge' | 'tavern';

// ------------------------------------------------------------------ upgrades

export interface UpgradeDef {
  id: string;
  shop: ShopId;
  name: string;
  icon: MetaIcon;
  max: number;
  baseCost: number;
  /** Each level costs this many times the one before. */
  growth: number;
  /** What the upgrade gives at `level`, as shown in the shop. */
  effect(level: number): string;
}

const pct = (n: number): string => `${Math.round(n)}%`;

export const UPGRADES: UpgradeDef[] = [
  // Forge: the orbs.
  { id: 'f_damage', shop: 'forge', name: 'Tempered Orbs', icon: 'power', max: 25, baseCost: 30, growth: 1.36, effect: (l) => `+${pct(3 * l)} orb damage` },
  { id: 'f_crit', shop: 'forge', name: 'Keen Edge', icon: 'crit', max: 10, baseCost: 80, growth: 1.9, effect: (l) => `+${l}% crit chance` },
  { id: 'f_critdmg', shop: 'forge', name: 'Heavy Strikes', icon: 'crit', max: 10, baseCost: 80, growth: 1.9, effect: (l) => `Crits deal ×${(2 + 0.08 * l).toFixed(2)}` },
  { id: 'f_stamina', shop: 'forge', name: 'Dense Core', icon: 'orb', max: 10, baseCost: 60, growth: 1.75, effect: (l) => `+${2 * l} bounces per orb` },
  { id: 'f_fire', shop: 'forge', name: 'Ember Mastery', icon: 'fire', max: 10, baseCost: 50, growth: 1.7, effect: (l) => `Burns +${pct(6 * l)} stronger` },
  { id: 'f_ice', shop: 'forge', name: 'Frost Mastery', icon: 'ice', max: 10, baseCost: 50, growth: 1.7, effect: (l) => `+${pct(50 * (1 + 0.06 * l))} damage to frozen blocks` },
  { id: 'f_storm', shop: 'forge', name: 'Storm Mastery', icon: 'lightning', max: 10, baseCost: 50, growth: 1.7, effect: (l) => `Arcs deal ${pct(50 * (1 + 0.06 * l))} of the hit` },
  { id: 'f_venom', shop: 'forge', name: 'Venom Mastery', icon: 'poison', max: 10, baseCost: 50, growth: 1.7, effect: (l) => `Poison +${pct(6 * l)} stronger` },
  // Tavern: the hero.
  { id: 't_health', shop: 'tavern', name: 'Hearty Meals', icon: 'life', max: 20, baseCost: 30, growth: 1.42, effect: (l) => `+${6 * l} max health` },
  { id: 't_armor', shop: 'tavern', name: 'Thick Hide', icon: 'life', max: 10, baseCost: 80, growth: 1.9, effect: (l) => `Breaches hurt ${pct(2 * l)} less` },
  { id: 't_regen', shop: 'tavern', name: 'Warm Bed', icon: 'life', max: 10, baseCost: 60, growth: 1.75, effect: (l) => `Heal ${l} per floor cleared` },
  { id: 't_coins', shop: 'tavern', name: 'Haggling', icon: 'gold', max: 20, baseCost: 40, growth: 1.4, effect: (l) => `+${pct(3 * l)} coins from kills` },
  { id: 't_salvage', shop: 'tavern', name: 'Deep Pockets', icon: 'gold', max: 10, baseCost: 60, growth: 1.75, effect: (l) => `Keep ${pct(25 + 4 * l)} of unbanked coins` },
];

export const UPGRADE_BY_ID: Record<string, UpgradeDef> = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

/** Coins to go from `level` to `level + 1`. */
export function upgradeCost(def: UpgradeDef, level: number): number {
  return Math.round((def.baseCost * Math.pow(def.growth, level)) / 5) * 5;
}

export function upgradeLevel(m: MetaState, id: string): number {
  return m.upgrades[id] ?? 0;
}

export function canBuyUpgrade(p: Profile, id: string): boolean {
  const def = UPGRADE_BY_ID[id];
  if (!def) return false;
  const level = upgradeLevel(p, id);
  return level < def.max && p.coins >= upgradeCost(def, level);
}

export function buyUpgrade(p: Profile, id: string): boolean {
  if (!canBuyUpgrade(p, id)) return false;
  const def = UPGRADE_BY_ID[id];
  const level = upgradeLevel(p, id);
  p.coins -= upgradeCost(def, level);
  p.upgrades[id] = level + 1;
  return true;
}

/** True if the player can afford anything in this shop right now. */
export function shopHasOffer(p: Profile, shop: ShopId): boolean {
  return UPGRADES.some((u) => u.shop === shop && canBuyUpgrade(p, u.id));
}

// ------------------------------------------------------------------- talents

export const BRANCHES = ['Arsenal', 'Alchemy', 'Warden'] as const;

export interface TalentDef {
  id: string;
  /** Index into BRANCHES. */
  branch: number;
  /** Row in the tree. A talent needs one rank in the tier above it in its branch. */
  tier: number;
  name: string;
  icon: MetaIcon;
  max: number;
  desc: string;
}

export const TALENTS: TalentDef[] = [
  { id: 'honed', branch: 0, tier: 0, name: 'Honed Orbs', icon: 'power', max: 3, desc: '+5% orb damage per rank.' },
  { id: 'spare_orb', branch: 0, tier: 1, name: 'Spare Orb', icon: 'orb', max: 1, desc: 'Start every run with a fourth plain orb.' },
  { id: 'instinct', branch: 0, tier: 2, name: 'Killer Instinct', icon: 'crit', max: 2, desc: '+3% critical hit chance per rank.' },
  { id: 'reserves', branch: 0, tier: 3, name: 'Deep Reserves', icon: 'orb', max: 2, desc: 'Orbs last 5 more bounces per rank.' },
  { id: 'salvo', branch: 0, tier: 4, name: 'Opening Salvo', icon: 'power', max: 1, desc: "Each orb's first 5 hits every turn deal +30% damage." },

  { id: 'attunement', branch: 1, tier: 0, name: 'Attunement', icon: 'ice', max: 3, desc: 'Burn, poison, lightning arcs and the frozen bonus are 6% stronger per rank.' },
  { id: 'catalyst', branch: 1, tier: 1, name: 'Catalyst', icon: 'fire', max: 2, desc: 'Elemental orbs hit 8% harder per rank.' },
  { id: 'reaction', branch: 1, tier: 2, name: 'Reaction', icon: 'lightning', max: 1, desc: 'A block with any two of burn, chill and poison on it takes +20% damage.' },
  { id: 'twin_orb', branch: 1, tier: 3, name: 'Twin Orb', icon: 'orb', max: 1, desc: 'Your starting elemental orb comes as a pair.' },
  { id: 'fallout', branch: 1, tier: 4, name: 'Fallout', icon: 'poison', max: 1, desc: 'When a block dies, a third of its burn and poison spreads to its neighbours, and a frozen block chills them.' },

  { id: 'toughness', branch: 2, tier: 0, name: 'Toughness', icon: 'life', max: 3, desc: '+10 max health per rank.' },
  { id: 'medic', branch: 2, tier: 1, name: 'Field Medic', icon: 'life', max: 2, desc: 'Heal 3 health per rank each time you clear a floor.' },
  { id: 'reroll', branch: 2, tier: 2, name: 'Second Opinion', icon: 'orb', max: 2, desc: 'One reroll of your upgrade choices per run, per rank.' },
  { id: 'ward', branch: 2, tier: 3, name: 'Ward', icon: 'ice', max: 1, desc: 'The first block to breach on each floor deals no damage.' },
  { id: 'foresight', branch: 2, tier: 4, name: 'Foresight', icon: 'crit', max: 1, desc: 'Choose from 4 upgrades after each floor instead of 3.' },
];

export const TALENT_BY_ID: Record<string, TalentDef> = Object.fromEntries(TALENTS.map((t) => [t.id, t]));
export const TOTAL_TALENT_RANKS = TALENTS.reduce((n, t) => n + t.max, 0);
/** One talent point per level after the first, and exactly enough levels to fill the tree. */
export const MAX_LEVEL = 1 + TOTAL_TALENT_RANKS;

export function talentRank(m: MetaState, id: string): number {
  return m.talents[id] ?? 0;
}

/** XP needed to go from `level` to `level + 1`. */
export const levelXp = (level: number): number => 30 + 50 * (level - 1);

export interface LevelInfo {
  level: number;
  /** XP into the current level. */
  into: number;
  /** XP the current level needs; 0 at the level cap. */
  need: number;
}

export function levelInfo(xp: number): LevelInfo {
  let level = 1;
  let left = Math.max(0, Math.floor(xp));
  while (level < MAX_LEVEL && left >= levelXp(level)) {
    left -= levelXp(level);
    level++;
  }
  return level >= MAX_LEVEL ? { level, into: 0, need: 0 } : { level, into: left, need: levelXp(level) };
}

/** XP a finished run is worth: floors cleared, plus a bonus per boss. */
export function xpForRun(floor: number, bossKills: number): number {
  return Math.max(0, floor - 1) * 10 + bossKills * 50;
}

export function spentPoints(m: MetaState): number {
  let n = 0;
  for (const t of TALENTS) n += talentRank(m, t.id);
  return n;
}

export function freePoints(p: Profile): number {
  return Math.max(0, levelInfo(p.xp).level - 1 - spentPoints(p));
}

/** The talent directly above `def` in its branch, if any. */
export function talentParent(def: TalentDef): TalentDef | null {
  return TALENTS.find((t) => t.branch === def.branch && t.tier === def.tier - 1) ?? null;
}

export type TalentStatus = 'maxed' | 'locked' | 'no-points' | 'ready';

export function talentStatus(p: Profile, id: string): TalentStatus {
  const def = TALENT_BY_ID[id];
  if (!def) return 'locked';
  if (talentRank(p, id) >= def.max) return 'maxed';
  const parent = talentParent(def);
  if (parent && talentRank(p, parent.id) < 1) return 'locked';
  return freePoints(p) > 0 ? 'ready' : 'no-points';
}

export function learnTalent(p: Profile, id: string): boolean {
  if (talentStatus(p, id) !== 'ready') return false;
  p.talents[id] = talentRank(p, id) + 1;
  return true;
}

/** Refund every talent point. Free, so players can try other builds. */
export function resetTalents(p: Profile): void {
  p.talents = {};
}

// ------------------------------------------------------------------- effects

/** Everything a profile adds to a run, in one place. */
export interface MetaBonus {
  /** Multiplier on orb damage. */
  dmg: number;
  critChance: number;
  critMult: number;
  bounces: number;
  /** Multipliers on each element's signature effect. */
  fire: number;
  ice: number;
  storm: number;
  venom: number;
  /** Multiplier on hits from elemental orbs. */
  elementalDmg: number;
  /** Bonus damage to blocks carrying two status effects; 0 = off. */
  reaction: number;
  fallout: boolean;
  openerHits: number;
  openerBonus: number;
  maxHp: number;
  /** Multiplier on damage taken from breaches. */
  breachMult: number;
  healOnFloor: number;
  coinMult: number;
  /** Extra share of unbanked coins kept when a run ends. */
  salvage: number;
  extraOrbs: number;
  /** Extra copies of the starter orb. */
  starterCopies: number;
  rerolls: number;
  /** Breaches ignored per floor. */
  wards: number;
  perkChoices: number;
  /** Hit damage multiplier for orbs of each element, from the orb collection. */
  orbPower: Record<Element, number>;
}

export function metaBonus(m: MetaState): MetaBonus {
  const u = (id: string): number => m.upgrades[id] ?? 0;
  const t = (id: string): number => m.talents[id] ?? 0;
  const attune = 1 + 0.06 * t('attunement');
  const power = {} as Record<Element, number>;
  for (const el of ORB_TYPES) power[el] = orbPower(m.orbs?.[el] ?? 1);
  return {
    dmg: (1 + 0.03 * u('f_damage')) * (1 + 0.05 * t('honed')),
    critChance: 0.01 * u('f_crit') + 0.03 * t('instinct'),
    critMult: 0.08 * u('f_critdmg'),
    bounces: 2 * u('f_stamina') + 5 * t('reserves'),
    fire: (1 + 0.06 * u('f_fire')) * attune,
    ice: (1 + 0.06 * u('f_ice')) * attune,
    storm: (1 + 0.06 * u('f_storm')) * attune,
    venom: (1 + 0.06 * u('f_venom')) * attune,
    elementalDmg: 1 + 0.08 * t('catalyst'),
    reaction: t('reaction') > 0 ? 0.2 : 0,
    fallout: t('fallout') > 0,
    openerHits: t('salvo') > 0 ? 5 : 0,
    openerBonus: t('salvo') > 0 ? 0.3 : 0,
    maxHp: 6 * u('t_health') + 10 * t('toughness'),
    breachMult: 1 - 0.02 * u('t_armor'),
    healOnFloor: u('t_regen') + 3 * t('medic'),
    coinMult: 1 + 0.03 * u('t_coins'),
    salvage: 0.04 * u('t_salvage'),
    extraOrbs: t('spare_orb'),
    starterCopies: t('twin_orb'),
    rerolls: t('reroll'),
    wards: t('ward'),
    perkChoices: 3 + t('foresight'),
    orbPower: power,
  };
}

// ------------------------------------------------------------------- helpers

/** Clean up whatever came out of storage: known ids only, whole numbers within range. */
export function sanitizeMeta(upgrades: unknown, talents: unknown): MetaState {
  const read = (raw: unknown, defs: { id: string; max: number }[]): Record<string, number> => {
    const out: Record<string, number> = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const d of defs) {
      const n = Math.floor(Number((raw as Record<string, unknown>)[d.id]));
      if (Number.isFinite(n) && n > 0) out[d.id] = Math.min(d.max, n);
    }
    return out;
  };
  const m: MetaState = { upgrades: read(upgrades, UPGRADES), talents: read(talents, TALENTS) };
  // Drop talents whose prerequisite is missing (a hand-edited or damaged save).
  for (const t of [...TALENTS].sort((a, b) => a.tier - b.tier)) {
    const parent = talentParent(t);
    if (parent && !m.talents[parent.id]) delete m.talents[t.id];
  }
  return m;
}

/**
 * A profile that is `fraction` of the way to fully upgraded: every upgrade and
 * orb at that share of its cap, and that share of the talent tree filled row by row.
 * Used by the balance bot and tests.
 */
export function metaAt(fraction: number): MetaState {
  const f = Math.min(1, Math.max(0, fraction));
  const orbs: Partial<Record<Element, number>> = {};
  const orbLevel = 1 + Math.round((MAX_ORB_LEVEL - 1) * f);
  if (orbLevel > 1) for (const el of ORB_TYPES) orbs[el] = orbLevel;
  const m: MetaState = { upgrades: {}, talents: {}, orbs };
  for (const u of UPGRADES) {
    const l = Math.round(u.max * f);
    if (l > 0) m.upgrades[u.id] = l;
  }
  let points = Math.round(TOTAL_TALENT_RANKS * f);
  for (const t of [...TALENTS].sort((a, b) => a.tier - b.tier || a.branch - b.branch)) {
    const r = Math.min(t.max, points);
    if (r > 0) m.talents[t.id] = r;
    points -= r;
  }
  return m;
}
