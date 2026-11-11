/**
 * The player's account outside a run, and everything that moves value in or
 * out of it: store products, chests, energy refills, pass rewards, and the
 * payout at the end of a run. Pure logic; the clock is passed in and nothing
 * here knows whether a purchase was real or simulated.
 */
import { ENERGY_MAX, ENERGY_REFILL_GEMS, energyAt, fillEnergy, newEnergy, type EnergyState } from './energy';
import { levelInfo, xpForRun, type MetaState, type Profile } from './meta';
import {
  CHESTS,
  CHEST_IDS,
  addOrb,
  newInventory,
  orbLevels,
  rollChest,
  type ChestId,
  type ChestLoot,
  type Inventory,
} from './orbs';
import { PASS_TIERS, claimTier, newPass, passTier, syncPass, type PassState, type Reward, type Track } from './pass';

export interface Wallet extends Profile {
  gems: number;
  inv: Inventory;
  /** Unopened chests. */
  chests: Record<ChestId, number>;
  energy: EnergyState;
  pass: PassState;
  starterBought: boolean;
  /** Free ad chests: the UTC day they were last claimed on, and how many that day. */
  adChest: { day: number; used: number };
  /** Seed state for chest rolls. It is saved, so reloading cannot reroll a chest. */
  rng: number;
}

/** New players start with enough gems for two revives. */
export const STARTER_GEMS = 100;

export function newWallet(now: number, seed: number): Wallet {
  return {
    coins: 0,
    gems: STARTER_GEMS,
    xp: 0,
    upgrades: {},
    talents: {},
    inv: newInventory(),
    chests: { wood: 0, silver: 0, gold: 0 },
    energy: newEnergy(now),
    pass: newPass(now),
    starterBought: false,
    adChest: { day: 0, used: 0 },
    rng: seed | 0,
  };
}

/** What a run is started with: upgrades, talents and the best orb of each element. */
export function runMeta(w: Wallet): MetaState {
  return { upgrades: w.upgrades, talents: w.talents, orbs: orbLevels(w.inv) };
}

export function grantReward(w: Wallet, r: Reward): void {
  if (r.coins) w.coins += r.coins;
  if (r.gems) w.gems += r.gems;
  if (r.chest) w.chests[r.chest] += 1;
}

// ------------------------------------------------------------------ products

export interface ProductDef {
  id: string;
  name: string;
  desc: string;
  kind: 'starter' | 'gems' | 'pass';
  grant: Reward;
}

/** Things sold for real money. Prices belong to the platform's store, not to the game. */
export const PRODUCTS: ProductDef[] = [
  { id: 'starter_pack', kind: 'starter', name: 'Starter Pack', desc: '400 gems, 3,000 coins and a Golden Chest. One time only.', grant: { gems: 400, coins: 3000, chest: 'gold' } },
  { id: 'gems_small', kind: 'gems', name: 'Handful of Gems', desc: '100 gems', grant: { gems: 100 } },
  { id: 'gems_medium', kind: 'gems', name: 'Pouch of Gems', desc: '550 gems', grant: { gems: 550 } },
  { id: 'gems_large', kind: 'gems', name: 'Hoard of Gems', desc: '1,200 gems', grant: { gems: 1200 } },
  { id: 'battle_pass', kind: 'pass', name: 'Premium Pass', desc: 'Unlocks the premium rewards for this season.', grant: {} },
];

export const PRODUCT_BY_ID: Record<string, ProductDef> = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));

/** False for one-off products the player already owns. */
export function productAvailable(w: Wallet, id: string): boolean {
  const def = PRODUCT_BY_ID[id];
  if (!def) return false;
  if (def.kind === 'starter') return !w.starterBought;
  if (def.kind === 'pass') return !w.pass.premium;
  return true;
}

/** Hand over a product after the platform has confirmed the purchase. */
export function grantProduct(w: Wallet, id: string): boolean {
  if (!productAvailable(w, id)) return false;
  const def = PRODUCT_BY_ID[id];
  grantReward(w, def.grant);
  if (def.kind === 'starter') w.starterBought = true;
  if (def.kind === 'pass') w.pass.premium = true;
  return true;
}

// -------------------------------------------------------------------- chests

export function canBuyChest(w: Wallet, id: ChestId): boolean {
  const price = CHESTS[id].price;
  return w.coins >= (price.coins ?? 0) && w.gems >= (price.gems ?? 0);
}

/** Pay for a chest. It lands unopened in the wallet. */
export function buyChest(w: Wallet, id: ChestId): boolean {
  if (!canBuyChest(w, id)) return false;
  const price = CHESTS[id].price;
  w.coins -= price.coins ?? 0;
  w.gems -= price.gems ?? 0;
  w.chests[id] += 1;
  return true;
}

/** Open one held chest: roll it and move the loot into the wallet. */
export function openChest(w: Wallet, id: ChestId): ChestLoot | null {
  if (w.chests[id] <= 0) return null;
  w.chests[id] -= 1;
  const loot = rollChest(id, w);
  w.coins += loot.coins;
  for (const o of loot.orbs) addOrb(w.inv, o.element, o.level);
  return loot;
}

export const heldChests = (w: Wallet): number => CHEST_IDS.reduce((n, id) => n + w.chests[id], 0);

export const AD_CHESTS_PER_DAY = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export function adChestsLeft(w: Wallet, now: number): number {
  const day = Math.floor(now / DAY_MS);
  return w.adChest.day === day ? Math.max(0, AD_CHESTS_PER_DAY - w.adChest.used) : AD_CHESTS_PER_DAY;
}

/** A free Wooden Chest for a watched ad, a few times a day. Call once the ad has paid out. */
export function claimAdChest(w: Wallet, now: number): boolean {
  if (adChestsLeft(w, now) <= 0) return false;
  const day = Math.floor(now / DAY_MS);
  w.adChest = { day, used: w.adChest.day === day ? w.adChest.used + 1 : 1 };
  w.chests.wood += 1;
  return true;
}

// -------------------------------------------------------------------- energy

export function canRefillEnergy(w: Wallet, now: number): boolean {
  return w.gems >= ENERGY_REFILL_GEMS && energyAt(w.energy, now).n < ENERGY_MAX;
}

export function refillEnergy(w: Wallet, now: number): boolean {
  if (!canRefillEnergy(w, now)) return false;
  w.gems -= ENERGY_REFILL_GEMS;
  fillEnergy(w.energy, now);
  return true;
}

// ---------------------------------------------------------------------- pass

export function claimPassReward(w: Wallet, track: Track, tier: number): Reward | null {
  const reward = claimTier(w.pass, track, tier);
  if (reward) grantReward(w, reward);
  return reward;
}

/** Collect every waiting pass reward. Returns what was collected. */
export function claimAllPass(w: Wallet): Reward[] {
  const out: Reward[] = [];
  for (let t = 1; t <= Math.min(PASS_TIERS, passTier(w.pass)); t++) {
    for (const track of ['free', 'paid'] as const) {
      const r = claimPassReward(w, track, t);
      if (r) out.push(r);
    }
  }
  return out;
}

// ----------------------------------------------------------------- run payout

export interface RunOutcome {
  coins: number;
  gems: number;
  floor: number;
  bossKills: number;
}

export interface RunPayout {
  xp: number;
  level: number;
  levelsGained: number;
  /** Wooden Chests earned, one per boss beaten. */
  chests: number;
  passTiersGained: number;
}

/** Bank everything a finished run earned. */
export function settleRun(w: Wallet, run: RunOutcome, now: number): RunPayout {
  w.coins += run.coins;
  w.gems += run.gems;
  const xp = xpForRun(run.floor, run.bossKills);
  const before = levelInfo(w.xp).level;
  w.xp += xp;
  const level = levelInfo(w.xp).level;
  syncPass(w.pass, now);
  const tierBefore = passTier(w.pass);
  w.pass.xp += xp;
  w.chests.wood += run.bossKills;
  return { xp, level, levelsGained: level - before, chests: run.bossKills, passTiersGained: passTier(w.pass) - tierBefore };
}
