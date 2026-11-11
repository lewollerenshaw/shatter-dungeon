import { describe, expect, it } from 'vitest';
import { parseSave } from '../src/save';
import {
  ENERGY_MAX,
  ENERGY_REFILL_GEMS,
  ENERGY_REGEN_MS,
  addEnergy,
  energyAt,
  formatWait,
  newEnergy,
  spendEnergy,
} from '../src/sim/energy';
import {
  CHESTS,
  CHEST_IDS,
  MAX_ORB_LEVEL,
  ORB_TYPES,
  addOrb,
  anyMergeable,
  mergeAll,
  mergeOnce,
  mergeable,
  newInventory,
  orbLevel,
  orbPower,
  rollChest,
  sanitizeInventory,
} from '../src/sim/orbs';
import {
  PASS_TIERS,
  PASS_TIER_XP,
  SEASON_EPOCH,
  SEASON_MS,
  canClaim,
  claimableCount,
  passReward,
  passTier,
  seasonAt,
  seasonEndsIn,
  syncPass,
} from '../src/sim/pass';
import {
  AD_CHESTS_PER_DAY,
  PRODUCTS,
  adChestsLeft,
  buyChest,
  claimAdChest,
  claimAllPass,
  claimPassReward,
  grantProduct,
  heldChests,
  newWallet,
  openChest,
  productAvailable,
  refillEnergy,
  runMeta,
  settleRun,
} from '../src/sim/store';
import { BASE_DMG } from '../src/sim/types';
import { UP, emptyRun, mkBall } from './helpers';

const T0 = SEASON_EPOCH + 3 * 24 * 3600 * 1000;
const DAY = 24 * 3600 * 1000;

describe('orb collection', () => {
  it('starts with one level 1 orb of each kind', () => {
    const inv = newInventory();
    for (const el of ORB_TYPES) {
      expect(orbLevel(inv, el)).toBe(1);
      expect(mergeable(inv, el)).toBe(0);
    }
    expect(anyMergeable(inv)).toBe(false);
    expect(orbPower(1)).toBe(1);
    expect(orbPower(4)).toBeCloseTo(1.3);
  });

  it('three of a level merge into one of the next, lowest level first', () => {
    const inv = newInventory();
    addOrb(inv, 'fire', 1, 2);
    addOrb(inv, 'fire', 2, 2);
    expect(mergeable(inv, 'fire')).toBe(1);
    expect(mergeOnce(inv, 'fire')).toBe(2);
    expect(inv.fire.slice(0, 3)).toEqual([0, 3, 0]);
    expect(mergeOnce(inv, 'fire')).toBe(3);
    expect(inv.fire.slice(0, 3)).toEqual([0, 0, 1]);
    expect(orbLevel(inv, 'fire')).toBe(3);
    expect(mergeOnce(inv, 'fire')).toBe(0);
    expect(orbLevel(inv, 'ice')).toBe(1);
  });

  it('merge all cascades and stops at the top level', () => {
    const inv = newInventory();
    addOrb(inv, 'poison', 1, 26); // 27 level 1 orbs = one level 4
    expect(mergeAll(inv)).toBe(9 + 3 + 1);
    expect(orbLevel(inv, 'poison')).toBe(4);
    expect(inv.poison.reduce((a, b) => a + b, 0)).toBe(1);

    addOrb(inv, 'ice', MAX_ORB_LEVEL, 5);
    expect(mergeable(inv, 'ice')).toBe(0);
    expect(mergeAll(inv)).toBe(0);
  });

  it('repairs a damaged inventory', () => {
    const inv = sanitizeInventory({ fire: [0, 2, 'x', -4], ice: 'nope', poison: [0, 0, 0, 0, 0, 0, 0, 99] });
    expect(inv.fire).toEqual([0, 2, 0, 0, 0, 0, 0]);
    expect(inv.ice).toEqual([1, 0, 0, 0, 0, 0, 0]);
    // An element can never be empty, and levels past the cap are dropped.
    expect(inv.poison).toEqual([1, 0, 0, 0, 0, 0, 0]);
    expect(inv.none[0]).toBe(1);
  });

  it('the best orb of an element powers that element in a run', () => {
    const w = newWallet(T0, 1);
    addOrb(w.inv, 'fire', 3);
    const meta = runMeta(w);
    expect(meta.orbs).toEqual({ none: 1, fire: 3, ice: 1, lightning: 1, poison: 1 });
    const run = emptyRun(1, meta);
    const b = run.addBlock({ col: 3, row: 3, hp: 1000 })!;
    run.hitBlock(mkBall('fire'), b, UP);
    expect(1000 - b.hp).toBeCloseTo(BASE_DMG * 1.2);
    const hp = b.hp;
    run.hitBlock(mkBall(), b, UP);
    expect(hp - b.hp).toBeCloseTo(BASE_DMG);
  });
});

describe('chests', () => {
  it('odds add up and every chest holds what it says', () => {
    for (const id of CHEST_IDS) {
      const def = CHESTS[id];
      expect(def.odds.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
      for (let seed = 1; seed <= 40; seed++) {
        const loot = rollChest(id, { rng: seed });
        expect(loot.orbs).toHaveLength(def.orbs);
        expect(loot.coins).toBeGreaterThanOrEqual(def.coins[0]);
        expect(loot.coins).toBeLessThanOrEqual(def.coins[1]);
        expect(Math.max(...loot.orbs.map((o) => o.level))).toBeGreaterThanOrEqual(def.guaranteed);
        for (const o of loot.orbs) {
          expect(o.level).toBeLessThanOrEqual(def.odds.length);
          expect(ORB_TYPES).toContain(o.element);
        }
      }
    }
  });

  it('the same seed opens the same chest', () => {
    expect(rollChest('gold', { rng: 99 })).toEqual(rollChest('gold', { rng: 99 }));
    expect(rollChest('gold', { rng: 99 })).not.toEqual(rollChest('gold', { rng: 100 }));
  });

  it('buying takes the price and opening moves the loot into the wallet', () => {
    const w = newWallet(T0, 7);
    expect(buyChest(w, 'silver')).toBe(true);
    expect(w.gems).toBe(0);
    expect(buyChest(w, 'silver')).toBe(false);
    expect(buyChest(w, 'wood')).toBe(false);
    expect(heldChests(w)).toBe(1);

    const loot = openChest(w, 'silver')!;
    expect(w.coins).toBe(loot.coins);
    const held = ORB_TYPES.reduce((n, el) => n + w.inv[el].reduce((a, b) => a + b, 0), 0);
    expect(held).toBe(ORB_TYPES.length + CHESTS.silver.orbs);
    expect(heldChests(w)).toBe(0);
    expect(openChest(w, 'silver')).toBeNull();

    w.coins = CHESTS.wood.price.coins!;
    expect(buyChest(w, 'wood')).toBe(true);
    expect(w.coins).toBe(0);
  });

  it('free ad chests are limited per day', () => {
    const w = newWallet(T0, 7);
    expect(adChestsLeft(w, T0)).toBe(AD_CHESTS_PER_DAY);
    for (let i = 0; i < AD_CHESTS_PER_DAY; i++) expect(claimAdChest(w, T0)).toBe(true);
    expect(claimAdChest(w, T0)).toBe(false);
    expect(w.chests.wood).toBe(AD_CHESTS_PER_DAY);
    expect(adChestsLeft(w, T0 + DAY)).toBe(AD_CHESTS_PER_DAY);
    expect(claimAdChest(w, T0 + DAY)).toBe(true);
    expect(adChestsLeft(w, T0 + DAY)).toBe(AD_CHESTS_PER_DAY - 1);
  });
});

describe('energy', () => {
  it('is spent per run and comes back over time, up to the cap', () => {
    const e = newEnergy(T0);
    expect(energyAt(e, T0)).toEqual({ n: ENERGY_MAX, nextMs: 0 });
    // Sitting at full banks no time.
    expect(spendEnergy(e, T0 + 10 * ENERGY_REGEN_MS)).toBe(true);
    const t = T0 + 10 * ENERGY_REGEN_MS;
    expect(energyAt(e, t)).toEqual({ n: ENERGY_MAX - 1, nextMs: ENERGY_REGEN_MS });
    expect(energyAt(e, t + ENERGY_REGEN_MS / 4).nextMs).toBe((ENERGY_REGEN_MS * 3) / 4);
    expect(energyAt(e, t + ENERGY_REGEN_MS).n).toBe(ENERGY_MAX);

    for (let i = 0; i < ENERGY_MAX - 1; i++) expect(spendEnergy(e, t)).toBe(true);
    expect(spendEnergy(e, t)).toBe(false);
    expect(energyAt(e, t + 2.5 * ENERGY_REGEN_MS)).toEqual({ n: 2, nextMs: ENERGY_REGEN_MS / 2 });
    expect(energyAt(e, t + 99 * ENERGY_REGEN_MS)).toEqual({ n: ENERGY_MAX, nextMs: 0 });
  });

  it('partial progress is kept when a point is spent', () => {
    const e = newEnergy(T0);
    spendEnergy(e, T0);
    spendEnergy(e, T0 + ENERGY_REGEN_MS / 2);
    expect(energyAt(e, T0 + ENERGY_REGEN_MS / 2)).toEqual({ n: ENERGY_MAX - 2, nextMs: ENERGY_REGEN_MS / 2 });
  });

  it('a clock that runs backwards earns nothing', () => {
    const e = newEnergy(T0);
    for (let i = 0; i < ENERGY_MAX; i++) spendEnergy(e, T0);
    expect(energyAt(e, T0 - 5 * ENERGY_REGEN_MS).n).toBe(0);
    expect(spendEnergy(e, T0 - 5 * ENERGY_REGEN_MS)).toBe(false);
  });

  it('refills cost gems and rewards can go past the cap', () => {
    const w = newWallet(T0, 1);
    expect(refillEnergy(w, T0)).toBe(false); // already full
    for (let i = 0; i < ENERGY_MAX; i++) spendEnergy(w.energy, T0);
    expect(refillEnergy(w, T0)).toBe(true);
    expect(w.gems).toBe(100 - ENERGY_REFILL_GEMS);
    expect(energyAt(w.energy, T0).n).toBe(ENERGY_MAX);
    w.gems = ENERGY_REFILL_GEMS - 1;
    spendEnergy(w.energy, T0);
    expect(refillEnergy(w, T0)).toBe(false);

    addEnergy(w.energy, T0, 3);
    expect(energyAt(w.energy, T0 + DAY).n).toBe(ENERGY_MAX + 2);
  });

  it('formats waits', () => {
    expect(formatWait(0)).toBe('0:00');
    expect(formatWait(65_000)).toBe('1:05');
    expect(formatWait(19 * 60_000 + 59_001)).toBe('20:00');
    expect(formatWait(3 * 3600_000 + 4 * 60_000 + 5000)).toBe('3:04:05');
  });
});

describe('season pass', () => {
  it('seasons are four-week windows', () => {
    expect(seasonAt(SEASON_EPOCH)).toBe(1);
    expect(seasonAt(SEASON_EPOCH + SEASON_MS - 1)).toBe(1);
    expect(seasonAt(SEASON_EPOCH + SEASON_MS)).toBe(2);
    expect(seasonEndsIn(SEASON_EPOCH + SEASON_MS - 1000)).toBe(1000);
    expect(seasonAt(0)).toBe(1);
  });

  it('xp unlocks tiers and premium rewards need the premium pass', () => {
    const w = newWallet(T0, 1);
    w.pass.xp = PASS_TIER_XP * 2 + 10;
    expect(passTier(w.pass)).toBe(2);
    expect(canClaim(w.pass, 'free', 3)).toBe(false);
    expect(canClaim(w.pass, 'paid', 1)).toBe(false);
    expect(claimableCount(w.pass)).toBe(2);

    const coins = w.coins;
    expect(claimPassReward(w, 'free', 1)).toEqual(passReward('free', 1));
    expect(w.coins).toBe(coins + passReward('free', 1).coins!);
    expect(claimPassReward(w, 'free', 1)).toBeNull();
    expect(claimPassReward(w, 'paid', 1)).toBeNull();

    expect(grantProduct(w, 'battle_pass')).toBe(true);
    expect(productAvailable(w, 'battle_pass')).toBe(false);
    expect(claimableCount(w.pass)).toBe(3);
    const gems = w.gems;
    expect(claimAllPass(w)).toHaveLength(3);
    expect(w.gems).toBe(gems + 10 + 30);
    expect(claimableCount(w.pass)).toBe(0);

    w.pass.xp = 1e9;
    expect(passTier(w.pass)).toBe(PASS_TIERS);
  });

  it('every tier pays something, with chests on every fifth', () => {
    for (let t = 1; t <= PASS_TIERS; t++) {
      for (const track of ['free', 'paid'] as const) {
        const r = passReward(track, t);
        expect((r.coins ?? 0) + (r.gems ?? 0) + (r.chest ? 1 : 0)).toBeGreaterThan(0);
        expect(Boolean(r.chest)).toBe(t % 5 === 0);
      }
    }
    expect(passReward('paid', PASS_TIERS).chest).toBe('gold');
  });

  it('a new season starts a fresh pass', () => {
    const w = newWallet(T0, 1);
    w.pass.xp = 5000;
    w.pass.premium = true;
    w.pass.free = [1, 2];
    expect(syncPass(w.pass, T0 + 1000)).toBe(false);
    expect(syncPass(w.pass, T0 + SEASON_MS)).toBe(true);
    expect(w.pass).toEqual({ season: 2, xp: 0, premium: false, free: [], paid: [] });
    expect(productAvailable(w, 'battle_pass')).toBe(true);
  });
});

describe('store products and run payout', () => {
  it('the starter pack is granted once, gem packs every time', () => {
    const w = newWallet(T0, 1);
    expect(new Set(PRODUCTS.map((p) => p.id)).size).toBe(PRODUCTS.length);
    expect(grantProduct(w, 'starter_pack')).toBe(true);
    expect(w.gems).toBe(100 + 400);
    expect(w.coins).toBe(3000);
    expect(w.chests.gold).toBe(1);
    expect(grantProduct(w, 'starter_pack')).toBe(false);
    expect(w.gems).toBe(500);

    expect(grantProduct(w, 'gems_small')).toBe(true);
    expect(grantProduct(w, 'gems_small')).toBe(true);
    expect(w.gems).toBe(700);
    expect(grantProduct(w, 'no_such_product')).toBe(false);
  });

  it('a finished run pays coins, gems, xp, pass xp and a chest per boss', () => {
    const w = newWallet(T0, 1);
    const out = settleRun(w, { coins: 800, gems: 15, floor: 12, bossKills: 1 }, T0);
    expect(out).toEqual({ xp: 160, level: 3, levelsGained: 2, chests: 1, passTiersGained: 0 });
    expect(w.coins).toBe(800);
    expect(w.gems).toBe(115);
    expect(w.pass.xp).toBe(160);
    expect(w.chests.wood).toBe(1);

    expect(settleRun(w, { coins: 0, gems: 0, floor: 12, bossKills: 1 }, T0).passTiersGained).toBe(1);
    // XP earned after the season rolls over counts for the new season only.
    settleRun(w, { coins: 0, gems: 0, floor: 6, bossKills: 0 }, T0 + SEASON_MS);
    expect(w.pass).toMatchObject({ season: 2, xp: 50 });
  });
});

describe('save file with the store', () => {
  it('gives an older save a fresh collection, full energy and a new pass', () => {
    const v2 = { v: 2, bestFloor: 20, coins: 5000, gems: 40, runs: 30, xp: 900, upgrades: { f_damage: 6 }, talents: { honed: 3 }, settings: { muted: false, speed: 4 } };
    const s = parseSave(JSON.stringify(v2), T0);
    expect(s).toMatchObject({ v: 4, coins: 5000, gems: 40, xp: 900, upgrades: { f_damage: 6 }, talents: { honed: 3 } });
    expect(s.inv).toEqual(newInventory());
    expect(s.chests).toEqual({ wood: 0, silver: 0, gold: 0 });
    expect(energyAt(s.energy, T0).n).toBe(ENERGY_MAX);
    expect(s.pass).toMatchObject({ season: 1, xp: 0, premium: false });
    expect(s.starterBought).toBe(false);
  });

  it('round-trips a played profile', () => {
    const w = { v: 4 as const, bestFloor: 9, runs: 4, settings: { muted: true, speed: 2 }, tower: parseSave(null, T0).tower, ...newWallet(T0, 4242) };
    grantProduct(w, 'starter_pack');
    openChest(w, 'gold');
    mergeAll(w.inv);
    spendEnergy(w.energy, T0);
    w.pass.xp = 700;
    claimPassReward(w, 'free', 2);
    claimAdChest(w, T0);
    expect(parseSave(JSON.stringify(w), T0 + 1000)).toEqual(w);
  });

  it('repairs damaged store data', () => {
    const s = parseSave(
      JSON.stringify({
        chests: { wood: -2, gold: 1.9 },
        energy: { n: 3, at: T0 + 10 * DAY },
        pass: { season: 1, xp: 600, premium: 1, free: [1, 1, 99, 'x'], paid: 'all' },
        rng: 'abc',
      }),
      T0,
    );
    expect(s.chests).toEqual({ wood: 0, silver: 0, gold: 1 });
    // A timestamp from the future restarts the timer instead of banking time.
    expect(s.energy).toEqual({ n: 3, at: T0 });
    expect(s.pass).toEqual({ season: 1, xp: 600, premium: true, free: [1], paid: [] });
    expect(Number.isInteger(s.rng)).toBe(true);
  });
});
