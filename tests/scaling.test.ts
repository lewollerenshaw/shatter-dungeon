import { describe, expect, it } from 'vitest';
import {
  affixChance,
  blockHp,
  bossHp,
  breachDamage,
  coinValue,
  fillChance,
  floorRows,
  isBossFloor,
  secondAffixChance,
} from '../src/sim/scaling';

describe('scaling curves', () => {
  it('block HP grows exponentially from 10', () => {
    expect(blockHp(1)).toBeCloseTo(10);
    const growth = blockHp(2) / blockHp(1);
    expect(growth).toBeGreaterThan(1.1);
    expect(growth).toBeLessThan(1.5);
    for (let f = 1; f < 100; f++) expect(blockHp(f + 1) / blockHp(f)).toBeCloseTo(growth);
  });

  it('bosses appear every 10 floors and are far tougher than a block', () => {
    expect([10, 20, 30].every(isBossFloor)).toBe(true);
    expect([0, 1, 9, 11, 15].some(isBossFloor)).toBe(false);
    expect(bossHp(10)).toBeGreaterThan(blockHp(10) * 20);
  });

  it('row count and fill chance are capped', () => {
    expect(floorRows(1)).toBe(5);
    expect(floorRows(200)).toBe(12);
    expect(fillChance(1)).toBeLessThan(fillChance(15));
    expect(fillChance(500)).toBeLessThanOrEqual(0.62);
  });

  it('affixes start at floor 3 and doubles at floor 12', () => {
    expect(affixChance(2)).toBe(0);
    expect(affixChance(3)).toBeGreaterThan(0);
    expect(affixChance(999)).toBeLessThanOrEqual(0.45);
    expect(secondAffixChance(11)).toBe(0);
    expect(secondAffixChance(12)).toBeGreaterThan(0);
  });

  it('threat and reward rise with depth', () => {
    expect(breachDamage(20)).toBeGreaterThan(breachDamage(1));
    expect(coinValue(20)).toBeGreaterThan(coinValue(1));
  });
});
