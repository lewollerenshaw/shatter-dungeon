/**
 * The orb collection: chests hand out orbs, three of a kind merge into one of
 * the next level, and the best orb of each element sets that element's power
 * in every run. Pure logic; randomness comes from a seeded holder.
 */
import { pick, rand, randInt, type RngHolder } from './rng';
import type { Element } from './types';

export const ORB_TYPES: Element[] = ['none', 'fire', 'ice', 'lightning', 'poison'];
export const MAX_ORB_LEVEL = 7;
/** Orbs of one level needed to make one of the next. */
export const MERGE_COUNT = 3;
/** Extra hit damage per orb level above the first. */
export const ORB_LEVEL_POWER = 0.1;

/** inv[element][i] is how many level i+1 orbs of that element the player holds. */
export type Inventory = Record<Element, number[]>;

const emptyStacks = (): number[] => new Array<number>(MAX_ORB_LEVEL).fill(0);

/** Everyone starts with one level 1 orb of each kind. */
export function newInventory(): Inventory {
  const inv = {} as Inventory;
  for (const el of ORB_TYPES) {
    inv[el] = emptyStacks();
    inv[el][0] = 1;
  }
  return inv;
}

/** The best orb of this element. Never below 1. */
export function orbLevel(inv: Inventory, el: Element): number {
  const stacks = inv[el];
  for (let i = MAX_ORB_LEVEL - 1; i > 0; i--) if (stacks[i] > 0) return i + 1;
  return 1;
}

export function orbLevels(inv: Inventory): Record<Element, number> {
  const out = {} as Record<Element, number>;
  for (const el of ORB_TYPES) out[el] = orbLevel(inv, el);
  return out;
}

export const orbPower = (level: number): number => 1 + ORB_LEVEL_POWER * (Math.max(1, level) - 1);

export function addOrb(inv: Inventory, el: Element, level: number, n = 1): void {
  const i = Math.min(MAX_ORB_LEVEL, Math.max(1, Math.floor(level))) - 1;
  inv[el][i] += n;
}

/** The lowest level of this element that has enough orbs to merge, or 0. */
export function mergeable(inv: Inventory, el: Element): number {
  const stacks = inv[el];
  for (let i = 0; i < MAX_ORB_LEVEL - 1; i++) if (stacks[i] >= MERGE_COUNT) return i + 1;
  return 0;
}

/** Merge one set of this element. Returns the level of the orb made, or 0 if none could be. */
export function mergeOnce(inv: Inventory, el: Element): number {
  const level = mergeable(inv, el);
  if (level === 0) return 0;
  inv[el][level - 1] -= MERGE_COUNT;
  inv[el][level] += 1;
  return level + 1;
}

/** Merge everything that can be merged. Returns how many merges happened. */
export function mergeAll(inv: Inventory): number {
  let n = 0;
  for (const el of ORB_TYPES) while (mergeOnce(inv, el) > 0) n++;
  return n;
}

export function anyMergeable(inv: Inventory): boolean {
  return ORB_TYPES.some((el) => mergeable(inv, el) > 0);
}

/** Repair an inventory read from storage. */
export function sanitizeInventory(raw: unknown): Inventory {
  const inv = newInventory();
  if (!raw || typeof raw !== 'object') return inv;
  for (const el of ORB_TYPES) {
    const stacks = (raw as Record<string, unknown>)[el];
    if (!Array.isArray(stacks)) continue;
    let total = 0;
    for (let i = 0; i < MAX_ORB_LEVEL; i++) {
      const n = Math.floor(Number(stacks[i]));
      inv[el][i] = Number.isFinite(n) && n > 0 ? n : 0;
      total += inv[el][i];
    }
    if (total === 0) inv[el][0] = 1;
  }
  return inv;
}

// -------------------------------------------------------------------- chests

export type ChestId = 'wood' | 'silver' | 'gold';
export const CHEST_IDS: ChestId[] = ['wood', 'silver', 'gold'];

export interface ChestDef {
  id: ChestId;
  name: string;
  /** Orbs inside. */
  orbs: number;
  coins: [number, number];
  /** Chance of each orb being level 1, 2, 3... Must sum to 1. */
  odds: number[];
  /** One orb in the chest is at least this level. */
  guaranteed: number;
  price: { coins?: number; gems?: number };
}

export const CHESTS: Record<ChestId, ChestDef> = {
  wood: { id: 'wood', name: 'Wooden Chest', orbs: 2, coins: [100, 300], odds: [0.9, 0.1], guaranteed: 1, price: { coins: 2500 } },
  silver: { id: 'silver', name: 'Silver Chest', orbs: 5, coins: [400, 900], odds: [0.72, 0.24, 0.04], guaranteed: 2, price: { gems: 100 } },
  gold: { id: 'gold', name: 'Golden Chest', orbs: 10, coins: [1500, 3000], odds: [0.5, 0.34, 0.14, 0.02], guaranteed: 3, price: { gems: 300 } },
};

export interface OrbDrop {
  element: Element;
  level: number;
}

export interface ChestLoot {
  chest: ChestId;
  coins: number;
  orbs: OrbDrop[];
}

function rollLevel(odds: number[], h: RngHolder): number {
  let roll = rand(h);
  for (let i = 0; i < odds.length; i++) {
    roll -= odds[i];
    if (roll < 0) return i + 1;
  }
  return odds.length;
}

/** Decide what a chest holds. Does not touch the inventory. */
export function rollChest(id: ChestId, h: RngHolder): ChestLoot {
  const def = CHESTS[id];
  const orbs: OrbDrop[] = [];
  for (let i = 0; i < def.orbs; i++) {
    const level = rollLevel(def.odds, h);
    orbs.push({ element: pick(h, ORB_TYPES), level: i === 0 ? Math.max(level, def.guaranteed) : level });
  }
  const [lo, hi] = def.coins;
  const coins = lo + 10 * randInt(h, Math.floor((hi - lo) / 10) + 1);
  // Best orbs last, so the reveal builds up.
  orbs.sort((a, b) => a.level - b.level);
  return { chest: id, coins, orbs };
}
