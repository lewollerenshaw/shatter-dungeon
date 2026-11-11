import { describe, expect, it } from 'vitest';
import { parseSave } from '../src/save';
import {
  MAX_LEVEL,
  NO_META,
  TALENTS,
  TOTAL_TALENT_RANKS,
  UPGRADES,
  UPGRADE_BY_ID,
  buyUpgrade,
  freePoints,
  learnTalent,
  levelInfo,
  levelXp,
  metaAt,
  resetTalents,
  talentParent,
  talentStatus,
  upgradeCost,
  xpForRun,
  type MetaState,
  type Profile,
} from '../src/sim/meta';
import { computeStats } from '../src/sim/perks';
import { Run } from '../src/sim/run';
import { BASE_DMG, ROWS } from '../src/sim/types';
import { UP, emptyRun, finishTurn, mkBall } from './helpers';

const profile = (over: Partial<Profile> = {}): Profile => ({ coins: 0, xp: 0, upgrades: {}, talents: {}, ...over });
const talents = (t: Record<string, number>): MetaState => ({ upgrades: {}, talents: t });
const upgrades = (u: Record<string, number>): MetaState => ({ upgrades: u, talents: {} });

describe('upgrades', () => {
  it('have unique ids and prices that rise with every level', () => {
    expect(new Set(UPGRADES.map((u) => u.id)).size).toBe(UPGRADES.length);
    for (const u of UPGRADES) {
      for (let l = 1; l < u.max; l++) expect(upgradeCost(u, l)).toBeGreaterThan(upgradeCost(u, l - 1));
      expect(u.effect(1)).not.toBe(u.effect(2));
    }
  });

  it('buying spends coins and stops at the cap or an empty purse', () => {
    const def = UPGRADE_BY_ID.f_crit;
    const p = profile({ coins: upgradeCost(def, 0) + upgradeCost(def, 1) - 1 });
    expect(buyUpgrade(p, 'f_crit')).toBe(true);
    expect(p.upgrades.f_crit).toBe(1);
    expect(p.coins).toBe(upgradeCost(def, 1) - 1);
    expect(buyUpgrade(p, 'f_crit')).toBe(false);
    expect(p.upgrades.f_crit).toBe(1);

    const rich = profile({ coins: 1e9, upgrades: { f_crit: def.max } });
    expect(buyUpgrade(rich, 'f_crit')).toBe(false);
    expect(buyUpgrade(rich, 'nonsense')).toBe(false);
    expect(rich.coins).toBe(1e9);
  });
});

describe('hero level and talents', () => {
  it('levels come from xp and stop when the tree can be filled', () => {
    expect(levelInfo(0)).toEqual({ level: 1, into: 0, need: levelXp(1) });
    expect(levelInfo(levelXp(1)).level).toBe(2);
    expect(levelInfo(levelXp(1) + levelXp(2) + 5)).toEqual({ level: 3, into: 5, need: levelXp(3) });
    expect(levelInfo(1e9)).toEqual({ level: MAX_LEVEL, into: 0, need: 0 });
    expect(MAX_LEVEL - 1).toBe(TOTAL_TALENT_RANKS);
    expect(xpForRun(1, 0)).toBe(0);
    expect(xpForRun(12, 1)).toBe(160);
  });

  it('every talent below the top row hangs off exactly one parent', () => {
    for (const t of TALENTS) {
      const parent = talentParent(t);
      if (t.tier === 0) expect(parent).toBeNull();
      else expect(parent?.branch).toBe(t.branch);
    }
  });

  it('learning needs a free point and the talent above', () => {
    const p = profile();
    expect(talentStatus(p, 'honed')).toBe('no-points');
    expect(learnTalent(p, 'honed')).toBe(false);

    p.xp = levelXp(1) + levelXp(2);
    expect(freePoints(p)).toBe(2);
    expect(talentStatus(p, 'spare_orb')).toBe('locked');
    expect(learnTalent(p, 'spare_orb')).toBe(false);
    expect(learnTalent(p, 'honed')).toBe(true);
    expect(learnTalent(p, 'spare_orb')).toBe(true);
    expect(talentStatus(p, 'spare_orb')).toBe('maxed');
    expect(freePoints(p)).toBe(0);
    expect(learnTalent(p, 'honed')).toBe(false);

    resetTalents(p);
    expect(freePoints(p)).toBe(2);
    expect(p.talents).toEqual({});
  });

  it('metaAt builds a legal tree and maxes everything at 1', () => {
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const m = metaAt(f);
      for (const t of TALENTS) {
        const parent = talentParent(t);
        if ((m.talents[t.id] ?? 0) > 0 && parent) expect(m.talents[parent.id]).toBeGreaterThan(0);
      }
    }
    const full = metaAt(1);
    for (const u of UPGRADES) expect(full.upgrades[u.id]).toBe(u.max);
    for (const t of TALENTS) expect(full.talents[t.id]).toBe(t.max);
    expect(metaAt(0)).toEqual({ upgrades: {}, talents: {}, orbs: {} });
    expect(full.orbs).toEqual({ none: 7, fire: 7, ice: 7, lightning: 7, poison: 7 });
  });
});

describe('meta in a run', () => {
  it('an empty profile changes nothing', () => {
    const base = computeStats({});
    expect(computeStats({}, NO_META)).toEqual(base);
    expect(base.dmg).toBe(1);
    expect(base.critChance).toBeCloseTo(0.05);
    expect(base.freezeBonus).toBeCloseTo(1.5);
    expect(base.chainDmg).toBeCloseTo(0.5);
    expect(base.perkChoices).toBe(3);
    const run = new Run(3);
    expect(run.s.hero.maxHp).toBe(100);
    expect(run.s.orbs).toHaveLength(3);
    expect(run.s.rerolls).toBe(0);
  });

  it('a full profile feeds stats, health, orbs and rerolls', () => {
    const run = new Run(3, metaAt(1));
    expect(run.stats.dmg).toBeCloseTo(1.75 * 1.15);
    expect(run.stats.critChance).toBeCloseTo(0.05 + 0.1 + 0.06);
    expect(run.stats.maxBounces).toBe(50 + 20 + 10);
    expect(run.stats.burnPower).toBeCloseTo(1.6 * 1.18);
    expect(run.s.hero.maxHp).toBe(100 + 120 + 30);
    expect(run.s.hero.hp).toBe(run.s.hero.maxHp);
    expect(run.s.orbs).toHaveLength(4);
    expect(run.s.rerolls).toBe(2);
    expect(run.s.perkChoices).toHaveLength(4);
  });

  it('keeps its own copy of the profile, and clones carry it', () => {
    const meta = upgrades({ f_damage: 5 });
    const run = new Run(9, meta);
    meta.upgrades.f_damage = 25;
    run.refreshStats();
    expect(run.stats.dmg).toBeCloseTo(1.15);
    expect(new Run(structuredClone(run.s)).stats.dmg).toBeCloseTo(1.15);
  });

  it('Twin Orb doubles the starter orb', () => {
    const run = new Run(11, talents({ twin_orb: 1 }));
    const id = run.s.perkChoices![0];
    run.choosePerk(0);
    expect(run.s.orbs).toHaveLength(5);
    expect(run.s.orbs.filter((o) => o !== 'none')).toHaveLength(2);
    expect(run.s.perks[id]).toBe(1);
  });

  it('rerolls swap the hand, run out, and never apply to the starter orb', () => {
    const fresh = new Run(4, talents({ reroll: 1 }));
    expect(fresh.rerollPerks()).toBe(false);
    expect(fresh.s.rerolls).toBe(1);

    const run = emptyRun(4, talents({ reroll: 1 }));
    run.s.rowsLeft = 0;
    run.endTurn();
    expect(run.s.phase).toBe('perk');
    const before = run.s.perkChoices!.slice();
    expect(run.rerollPerks()).toBe(true);
    expect(run.s.perkChoices).toHaveLength(3);
    for (const id of run.s.perkChoices!) expect(before).not.toContain(id);
    expect(run.rerollPerks()).toBe(false);
  });

  it('Ward absorbs the first breach of a floor, and Thick Hide softens the rest', () => {
    const run = emptyRun(1, { upgrades: { t_armor: 10 }, talents: { ward: 1 } });
    run.s.wards = run.stats.wards;
    run.addBlock({ col: 0, row: ROWS - 1, hp: 50 });
    run.endTurn();
    expect(run.s.hero.hp).toBe(100);
    expect(run.s.wards).toBe(0);
    expect(run.events.some((e) => e.t === 'ward')).toBe(true);

    finishTurn(run);
    run.addBlock({ col: 6, row: ROWS - 1, hp: 50 });
    run.endTurn();
    // Floor 1 breach is 9, less 20%.
    expect(run.s.hero.hp).toBe(100 - 7);
  });

  it('Deep Pockets keeps more of the unbanked coins', () => {
    const run = emptyRun(1, upgrades({ t_salvage: 10 }));
    run.s.loot.coins = 100;
    expect(run.payout()).toEqual({ coins: 65, gems: 0, lost: 35 });
  });

  it('Opening Salvo boosts only the first hits, Catalyst only elemental orbs', () => {
    const run = emptyRun(1, talents({ salvo: 1, catalyst: 2 }));
    const b = run.addBlock({ col: 3, row: 3, hp: 1000 })!;
    const ball = mkBall();
    run.hitBlock(ball, b, UP);
    expect(1000 - b.hp).toBeCloseTo(BASE_DMG * 1.3);
    ball.bounces = 5;
    const hp = b.hp;
    run.hitBlock(ball, b, UP);
    expect(hp - b.hp).toBeCloseTo(BASE_DMG);

    const fire = mkBall('fire');
    fire.bounces = 10;
    const hp2 = b.hp;
    run.hitBlock(fire, b, UP);
    expect(hp2 - b.hp).toBeCloseTo(BASE_DMG * 1.16);
  });

  it('Reaction rewards two status effects on one block', () => {
    const run = emptyRun(1, talents({ reaction: 1 }));
    const b = run.addBlock({ col: 3, row: 3, hp: 1000 })!;
    const ball = mkBall();
    b.burn = 1;
    run.hitBlock(ball, b, UP);
    expect(1000 - b.hp).toBeCloseTo(BASE_DMG);
    b.poison = 1;
    const hp = b.hp;
    run.hitBlock(ball, b, UP);
    expect(hp - b.hp).toBeCloseTo(BASE_DMG * 1.2);
  });

  it('Fallout spreads a third of the poison and burn of a dying block', () => {
    const run = emptyRun(1, talents({ fallout: 1 }));
    const victim = run.addBlock({ col: 3, row: 3, hp: 1 })!;
    const near = run.addBlock({ col: 4, row: 3, hp: 1000 })!;
    const far = run.addBlock({ col: 6, row: 3, hp: 1000 })!;
    victim.poison = 5;
    run.hitBlock(mkBall(), victim, UP);
    expect(victim.dead).toBe(true);
    expect(near.poison).toBe(2);
    expect(far.poison).toBe(0);

    const plain = emptyRun(1);
    const v2 = plain.addBlock({ col: 3, row: 3, hp: 1 })!;
    const n2 = plain.addBlock({ col: 4, row: 3, hp: 1000 })!;
    v2.poison = 5;
    plain.hitBlock(mkBall(), v2, UP);
    expect(n2.poison).toBe(0);
  });

  it('stays deterministic with a full profile', () => {
    const play = (): string => {
      const run = new Run(77, metaAt(1));
      run.silent = true;
      run.choosePerk(1);
      for (let turn = 0; turn < 6 && run.s.phase !== 'dead'; turn++) {
        finishTurn(run);
        if (run.s.phase === 'perk') run.choosePerk(0);
        finishTurn(run);
        run.fire(1.1 + turn * 0.15);
        finishTurn(run);
      }
      return JSON.stringify(run.s);
    };
    expect(play()).toBe(play());
  });
});

describe('save file', () => {
  it('loads a save from before progression existed', () => {
    const s = parseSave(JSON.stringify({ v: 1, bestFloor: 14, coins: 320, gems: 65, runs: 9, settings: { muted: true, speed: 2 } }));
    expect(s).toMatchObject({
      v: 4,
      bestFloor: 14,
      coins: 320,
      gems: 65,
      runs: 9,
      xp: 0,
      upgrades: {},
      talents: {},
      settings: { muted: true, speed: 2 },
    });
  });

  it('repairs damaged progression data', () => {
    const s = parseSave(
      JSON.stringify({
        coins: -50,
        xp: 'lots',
        upgrades: { f_damage: 999, f_crit: 2.9, bogus: 4, t_health: -3 },
        talents: { honed: 2, salvo: 1, spare_orb: 1, foresight: 1 },
      }),
    );
    expect(s.coins).toBe(0);
    expect(s.xp).toBe(0);
    expect(s.upgrades).toEqual({ f_damage: 25, f_crit: 2 });
    // Salvo and Foresight sit below talents that were never learned.
    expect(s.talents).toEqual({ honed: 2, spare_orb: 1 });
  });

  it('falls back to a new profile on nonsense', () => {
    for (const raw of [null, '', 'not json', '42', 'null']) {
      const s = parseSave(raw);
      expect(s.gems).toBe(100);
      expect(s.upgrades).toEqual({});
    }
  });
});
