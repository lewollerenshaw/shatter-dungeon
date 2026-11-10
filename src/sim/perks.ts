import { NO_META, metaBonus, type MetaState } from './meta';
import { rand } from './rng';
import { BALL_RADIUS, type Element, type PerkReason, type RunState } from './types';

export type Rarity = 'common' | 'rare' | 'epic';

export interface PerkDef {
  id: string;
  name: string;
  desc: string;
  rarity: Rarity;
  /** Colour/glyph key used by the perk card. */
  icon: Element | 'power' | 'crit' | 'life' | 'gold' | 'orb';
  max?: number;
  /** Only offered when this returns true (e.g. you own a matching orb). */
  requires?: (s: RunState) => boolean;
}

const has = (s: RunState, el: Element): boolean => s.orbs.includes(el) || (s.perks.prism_core ?? 0) > 0;
const owns = (s: RunState, id: string): boolean => (s.perks[id] ?? 0) > 0;

export const PERKS: PerkDef[] = [
  // Orbs
  { id: 'ember_orb', name: 'Ember Orb', rarity: 'common', icon: 'fire', desc: '+1 Fire orb. Hits burn, and burning blocks explode when they die.' },
  { id: 'frost_orb', name: 'Frost Orb', rarity: 'common', icon: 'ice', desc: '+1 Frost orb. Three hits freeze a block: it skips its next step and takes +50% damage.' },
  { id: 'storm_orb', name: 'Storm Orb', rarity: 'common', icon: 'lightning', desc: '+1 Storm orb. Every hit arcs to 2 nearby blocks for half damage.' },
  { id: 'venom_orb', name: 'Venom Orb', rarity: 'common', icon: 'poison', desc: '+1 Venom orb. Hits stack poison that ticks every turn and never fades.' },
  { id: 'extra_orb', name: 'Extra Orb', rarity: 'common', icon: 'orb', desc: '+1 plain orb.' },
  { id: 'multiball', name: 'Orb Cluster', rarity: 'epic', icon: 'orb', desc: '+3 plain orbs.' },
  // Raw power
  { id: 'sharpen', name: 'Sharpened Core', rarity: 'common', icon: 'power', desc: '+20% orb damage.' },
  { id: 'heavy_core', name: 'Heavy Core', rarity: 'common', icon: 'power', max: 5, desc: 'Orbs are 10% bigger and hit 10% harder.' },
  { id: 'keen_eye', name: 'Keen Eye', rarity: 'common', icon: 'crit', max: 8, desc: '+6% critical hit chance.' },
  { id: 'brutal_crits', name: 'Brutal Crits', rarity: 'rare', icon: 'crit', desc: 'Critical hits deal +50% more damage.' },
  { id: 'crit_explosion', name: 'Shatterpoint', rarity: 'epic', icon: 'crit', desc: 'Critical hits explode, dealing 50% of the hit to every neighbour.' },
  { id: 'momentum', name: 'Momentum', rarity: 'rare', icon: 'power', desc: '+2% damage for every bounce this turn (up to 100 bounces).' },
  { id: 'piercing', name: 'Piercing Shot', rarity: 'rare', icon: 'power', max: 4, desc: "Each orb's first hit every turn passes straight through the block." },
  { id: 'endurance', name: 'Tireless Orbs', rarity: 'rare', icon: 'orb', desc: 'Orbs last 20 more bounces before they burn out and fly home.' },
  { id: 'split_shot', name: 'Split Shot', rarity: 'rare', icon: 'orb', max: 5, desc: '8% chance on hit to split off a temporary half-damage orb.' },
  { id: 'executioner', name: 'Executioner', rarity: 'epic', icon: 'crit', max: 2, desc: 'Blocks below 15% health shatter instantly. (20% at level 2.)' },
  { id: 'glass_cannon', name: 'Glass Cannon', rarity: 'epic', icon: 'power', max: 2, desc: '+60% orb damage, but lose 30 max health.' },
  // Elemental synergies
  { id: 'static_charge', name: 'Static Charge', rarity: 'rare', icon: 'lightning', max: 4, desc: "Every 5th bounce of any orb fires a lightning arc. Each level makes it one bounce sooner." },
  { id: 'overload', name: 'Overload', rarity: 'rare', icon: 'lightning', desc: 'Lightning arcs hit 1 more block and deal +15% damage.', requires: (s) => has(s, 'lightning') || owns(s, 'static_charge') },
  { id: 'wildfire', name: 'Wildfire', rarity: 'rare', icon: 'fire', desc: 'Burns and fire explosions are 50% stronger.', requires: (s) => has(s, 'fire') },
  { id: 'deep_freeze', name: 'Deep Freeze', rarity: 'rare', icon: 'ice', max: 2, desc: 'Blocks freeze one hit sooner and take +25% more damage while frozen.', requires: (s) => has(s, 'ice') },
  { id: 'virulence', name: 'Virulence', rarity: 'rare', icon: 'poison', desc: 'Poison ticks 50% harder and each hit applies +1 stack.', requires: (s) => has(s, 'poison') || owns(s, 'toxic_ground') },
  { id: 'toxic_ground', name: 'Toxic Ground', rarity: 'rare', icon: 'poison', desc: 'Every kill leaves a poison pool that infects whatever steps into it.' },
  { id: 'prism_core', name: 'Prism Core', rarity: 'epic', icon: 'orb', max: 1, desc: 'Plain orbs take on a random element every turn.', requires: (s) => s.orbs.includes('none') },
  // Survival and economy
  { id: 'vitality', name: 'Vitality', rarity: 'common', icon: 'life', desc: '+25 max health and heal 25.' },
  { id: 'second_wind', name: 'Second Wind', rarity: 'common', icon: 'life', desc: 'Heal 12 health each time you clear a floor.' },
  { id: 'gold_rush', name: 'Gold Rush', rarity: 'common', icon: 'gold', desc: '+30% coins from kills.' },
];

export const PERK_BY_ID: Record<string, PerkDef> = Object.fromEntries(PERKS.map((p) => [p.id, p]));

/** Base number of block hits an orb gets per turn. Keeps turns short and damage bounded. */
export const ORB_BOUNCES = 50;

export const ORB_PERKS = ['ember_orb', 'frost_orb', 'storm_orb', 'venom_orb'];

/** Numbers derived from the perks a run holds and the profile it started with. Recomputed whenever a perk is taken. */
export interface Stats {
  dmg: number;
  critChance: number;
  critMult: number;
  ballRadius: number;
  splitChance: number;
  /** Every Nth bounce arcs lightning; 0 = off. */
  chainEvery: number;
  chainCount: number;
  chainDmg: number;
  burnPower: number;
  poisonPower: number;
  poisonStacks: number;
  poolOnKill: boolean;
  poolStacks: number;
  freezeAt: number;
  freezeBonus: number;
  pierce: number;
  critExplode: number;
  comboDmg: number;
  healOnFloor: number;
  coinMult: number;
  /** Block hits an orb can make in a turn before it burns out and returns. */
  maxBounces: number;
  /** Health fraction below which non-boss blocks die instantly; 0 = off. */
  execute: number;
  prism: boolean;
  /** Multiplier on hits from elemental orbs. */
  elementalDmg: number;
  /** Bonus damage to blocks carrying two status effects; 0 = off. */
  reaction: number;
  /** Dying blocks pass their burn, poison and chill to neighbours. */
  fallout: boolean;
  /** An orb's first N hits each turn deal `openerBonus` extra. */
  openerHits: number;
  openerBonus: number;
  /** Multiplier on damage the hero takes from breaches. */
  breachMult: number;
  /** Extra share of unbanked coins kept when the run ends. */
  salvage: number;
  /** Breaches ignored on each floor. */
  wards: number;
  /** Cards offered after each floor. */
  perkChoices: number;
  /** Extra copies of the starter orb. */
  starterCopies: number;
}

export function computeStats(perks: Record<string, number>, meta: MetaState = NO_META): Stats {
  const n = (id: string): number => perks[id] ?? 0;
  const m = metaBonus(meta);
  const charge = n('static_charge');
  const exec = n('executioner');
  return {
    dmg: (1 + 0.2 * n('sharpen')) * (1 + 0.1 * n('heavy_core')) * (1 + 0.6 * n('glass_cannon')) * m.dmg,
    critChance: Math.min(0.9, 0.05 + 0.06 * n('keen_eye') + m.critChance),
    critMult: 2 + 0.5 * n('brutal_crits') + m.critMult,
    ballRadius: BALL_RADIUS * (1 + 0.1 * Math.min(5, n('heavy_core'))),
    splitChance: Math.min(0.4, 0.08 * n('split_shot')),
    chainEvery: charge > 0 ? Math.max(2, 6 - charge) : 0,
    chainCount: 2 + n('overload'),
    chainDmg: (0.5 + 0.15 * n('overload')) * m.storm,
    burnPower: (1 + 0.5 * n('wildfire')) * m.fire,
    poisonPower: (1 + 0.5 * n('virulence')) * m.venom,
    poisonStacks: 1 + n('virulence'),
    poolOnKill: n('toxic_ground') > 0,
    poolStacks: 2 + n('toxic_ground'),
    freezeAt: Math.max(1, 3 - n('deep_freeze')),
    freezeBonus: 1 + (0.5 + 0.25 * n('deep_freeze')) * m.ice,
    pierce: n('piercing'),
    critExplode: 0.5 * n('crit_explosion'),
    comboDmg: 0.02 * n('momentum'),
    healOnFloor: 12 * n('second_wind') + m.healOnFloor,
    coinMult: (1 + 0.3 * n('gold_rush')) * m.coinMult,
    maxBounces: ORB_BOUNCES + 20 * n('endurance') + m.bounces,
    execute: exec > 0 ? 0.1 + 0.05 * exec : 0,
    prism: n('prism_core') > 0,
    elementalDmg: m.elementalDmg,
    reaction: m.reaction,
    fallout: m.fallout,
    openerHits: m.openerHits,
    openerBonus: m.openerBonus,
    breachMult: m.breachMult,
    salvage: m.salvage,
    wards: m.wards,
    perkChoices: m.perkChoices,
    starterCopies: m.starterCopies,
  };
}

/** One-off effects of taking a perk (stat changes come from computeStats). */
export function applyPerk(s: RunState, id: string): void {
  switch (id) {
    case 'ember_orb':
      s.orbs.push('fire');
      break;
    case 'frost_orb':
      s.orbs.push('ice');
      break;
    case 'storm_orb':
      s.orbs.push('lightning');
      break;
    case 'venom_orb':
      s.orbs.push('poison');
      break;
    case 'extra_orb':
      s.orbs.push('none');
      break;
    case 'multiball':
      s.orbs.push('none', 'none', 'none');
      break;
    case 'vitality':
      s.hero.maxHp += 25;
      s.hero.hp = Math.min(s.hero.maxHp, s.hero.hp + 25);
      break;
    case 'glass_cannon':
      s.hero.maxHp = Math.max(20, s.hero.maxHp - 30);
      s.hero.hp = Math.min(s.hero.hp, s.hero.maxHp);
      break;
  }
}

function rarityWeight(r: Rarity, floor: number, reason: PerkReason): number {
  if (reason === 'boss') return r === 'common' ? 0 : r === 'rare' ? 60 : 40;
  if (r === 'common') return 60;
  if (r === 'rare') return 28 + floor;
  return 5 + floor * 0.5;
}

/**
 * Distinct perk ids to offer. The run opens with a choice of elemental orb.
 * `exclude` (the hand being rerolled) is avoided when enough other perks exist.
 */
export function rollPerks(s: RunState, reason: PerkReason, count = 3, exclude: string[] = []): string[] {
  let pool = PERKS.filter((p) => (s.perks[p.id] ?? 0) < (p.max ?? 99) && (!p.requires || p.requires(s)));
  if (reason === 'starter') pool = pool.filter((p) => ORB_PERKS.includes(p.id));
  if (exclude.length > 0) {
    const rest = pool.filter((p) => !exclude.includes(p.id));
    if (rest.filter((p) => rarityWeight(p.rarity, s.floor, reason) > 0).length >= count) pool = rest;
  }
  const weighted = pool
    .map((p) => ({ id: p.id, w: rarityWeight(p.rarity, s.floor, reason) }))
    .filter((p) => p.w > 0);
  const out: string[] = [];
  while (out.length < count && weighted.length > 0) {
    let total = 0;
    for (const p of weighted) total += p.w;
    let roll = rand(s) * total;
    let idx = weighted.length - 1;
    for (let i = 0; i < weighted.length; i++) {
      roll -= weighted[i].w;
      if (roll < 0) {
        idx = i;
        break;
      }
    }
    out.push(weighted[idx].id);
    weighted.splice(idx, 1);
  }
  return out;
}
