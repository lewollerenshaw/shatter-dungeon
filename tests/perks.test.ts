import { describe, expect, it } from 'vitest';
import { ORB_PERKS, PERKS, PERK_BY_ID, computeStats, rollPerks } from '../src/sim/perks';
import { Run } from '../src/sim/run';
import { BASE_DMG } from '../src/sim/types';
import { UP, emptyRun, mkBall } from './helpers';

describe('perk table', () => {
  it('has unique ids and around twenty or more perks', () => {
    expect(new Set(PERKS.map((p) => p.id)).size).toBe(PERKS.length);
    expect(PERKS.length).toBeGreaterThanOrEqual(20);
  });

  it('stats stack', () => {
    const base = computeStats({});
    expect(base.dmg).toBe(1);
    expect(base.critChance).toBeCloseTo(0.05);
    const s = computeStats({ sharpen: 2, heavy_core: 1, keen_eye: 3, brutal_crits: 2, static_charge: 2 });
    expect(s.dmg).toBeCloseTo(1.4 * 1.1);
    expect(s.critChance).toBeCloseTo(0.23);
    expect(s.critMult).toBe(3);
    expect(s.chainEvery).toBe(4);
    expect(computeStats({ static_charge: 99 }).chainEvery).toBe(2);
    expect(computeStats({ keen_eye: 99 }).critChance).toBeLessThanOrEqual(0.9);
  });
});

describe('perk offers', () => {
  it('a run opens with a choice of three elemental orbs', () => {
    const run = new Run(7);
    expect(run.s.phase).toBe('perk');
    expect(run.s.perkChoices).toHaveLength(3);
    expect(run.s.perkChoices!.every((id) => ORB_PERKS.includes(id))).toBe(true);
    run.choosePerk(0);
    expect(run.s.orbs).toHaveLength(4);
    expect(run.s.orbs[3]).not.toBe('none');
    expect(run.s.floor).toBe(1);
  });

  it('offers three distinct, valid perks and respects max stacks and requirements', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const run = emptyRun(seed);
      run.s.perks = { prism_core: 1, heavy_core: 5 };
      run.s.orbs = ['none', 'fire'];
      const offer = rollPerks(run.s, 'floor');
      expect(offer).toHaveLength(3);
      expect(new Set(offer).size).toBe(3);
      for (const id of offer) expect(PERK_BY_ID[id]).toBeDefined();
      expect(offer).not.toContain('prism_core');
      expect(offer).not.toContain('heavy_core');
    }
    const run = emptyRun(3);
    run.s.orbs = ['none'];
    for (let i = 0; i < 100; i++) expect(rollPerks(run.s, 'floor')).not.toContain('wildfire');
  });

  it('boss rewards are never common', () => {
    const run = emptyRun(9);
    for (let i = 0; i < 50; i++) {
      for (const id of rollPerks(run.s, 'boss')) expect(PERK_BY_ID[id].rarity).not.toBe('common');
    }
  });
});

describe('perk effects in combat', () => {
  const withPerks = (perks: Record<string, number>) => {
    const run = emptyRun();
    run.s.perks = perks;
    run.refreshStats();
    run.stats.critChance = 0;
    return run;
  };

  it('damage perks multiply orb damage', () => {
    const run = withPerks({ sharpen: 5 });
    const b = run.addBlock({ col: 3, row: 3, hp: 100 })!;
    run.hitBlock(mkBall(), b, UP);
    expect(b.hp).toBe(100 - BASE_DMG * 2);
  });

  it('piercing lets the orb through once', () => {
    const run = withPerks({ piercing: 1 });
    const b = run.addBlock({ col: 3, row: 3, hp: 100 })!;
    const ball = mkBall();
    ball.pierce = run.stats.pierce;
    expect(run.hitBlock(ball, b, UP)).toBe(false);
    expect(run.hitBlock(ball, b, UP)).toBe(true);
    expect(b.hp).toBe(100 - BASE_DMG * 2);
  });

  it('executioner finishes weakened blocks', () => {
    const run = withPerks({ executioner: 1 });
    const b = run.addBlock({ col: 3, row: 3, hp: 100 })!;
    b.hp = 17;
    run.hitBlock(mkBall(), b, UP);
    expect(b.dead).toBe(true);
  });

  it('static charge arcs on every Nth bounce', () => {
    const run = withPerks({ static_charge: 4 }); // every 2nd bounce
    const a = run.addBlock({ col: 3, row: 3, hp: 100 })!;
    const b = run.addBlock({ col: 4, row: 3, hp: 100 })!;
    const ball = mkBall();
    run.hitBlock(ball, a, UP);
    expect(b.hp).toBe(100);
    run.hitBlock(ball, a, UP);
    expect(b.hp).toBe(100 - BASE_DMG / 2);
  });

  it('split shot spawns temporary orbs', () => {
    const run = withPerks({ split_shot: 5 });
    run.stats.splitChance = 1;
    const a = run.addBlock({ col: 3, row: 3, hp: 100 })!;
    run.hitBlock(mkBall(), a, UP);
    expect(run.s.balls).toHaveLength(1);
    expect(run.s.balls[0].temp).toBe(true);
  });

  it('momentum scales with the combo', () => {
    const run = withPerks({ momentum: 1 });
    const a = run.addBlock({ col: 3, row: 3, hp: 1000 })!;
    run.hitBlock(mkBall(), a, UP);
    expect(1000 - a.hp).toBeCloseTo(BASE_DMG * 1.02);
  });

  it('toxic ground leaves a pool on any kill', () => {
    const run = withPerks({ toxic_ground: 1 });
    const a = run.addBlock({ col: 3, row: 3, hp: 1 })!;
    run.hitBlock(mkBall(), a, UP);
    expect(run.s.pools).toEqual([{ col: 3, row: 3, turns: 3, stacks: 3 }]);
  });
});
