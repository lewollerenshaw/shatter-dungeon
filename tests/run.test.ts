import { describe, expect, it } from 'vitest';
import { Run } from '../src/sim/run';
import { BOSS_GEMS, TURN_LIMIT } from '../src/sim/types';
import { emptyRun, finishTurn } from './helpers';

/** Plays a run with sweeping shots until `stop` is true. Returns turns taken. */
function play(run: Run, stop: (r: Run) => boolean, maxTurns = 4000): number {
  let turns = 0;
  while (!stop(run) && turns < maxTurns) {
    const p = run.s.phase;
    if (p === 'perk') run.choosePerk(0);
    else if (p === 'aim') run.fire(0.5 + ((turns++ * 0.618) % 1) * 2.1);
    else if (p === 'dead' || p === 'over') break;
    else finishTurn(run);
  }
  return turns;
}

describe('run flow', () => {
  it('a turn fires every orb, brings them home, and advances the board', () => {
    const run = new Run(42);
    run.choosePerk(0);
    finishTurn(run);
    expect(run.s.phase).toBe('aim');
    const rowsLeft = run.s.rowsLeft;
    expect(run.fire(Math.PI / 2)).toBe(true);
    expect(run.fire(1)).toBe(false);
    finishTurn(run);
    expect(run.s.balls).toHaveLength(0);
    expect(run.s.stats.turns).toBe(1);
    expect(run.s.stats.damage).toBeGreaterThan(0);
    expect(run.s.phase === 'aim' || run.s.phase === 'perk').toBe(true);
    if (run.s.phase === 'aim') expect(run.s.rowsLeft).toBeLessThan(rowsLeft);
  });

  it('no turn can outlast the turn limit', () => {
    const run = emptyRun();
    // An indestructible box around the launch column keeps the orb bouncing.
    for (let col = 0; col < 7; col++) run.addBlock({ col, row: 0, hp: 1e15 });
    run.fire(Math.PI / 2);
    let t = 0;
    while (run.s.phase === 'firing' && t < TURN_LIMIT + 5) {
      run.update(0.5);
      t += 0.5;
    }
    expect(run.s.phase).not.toBe('firing');
  });

  it('clearing a floor offers perks and then starts the next floor', () => {
    const run = new Run(5);
    run.choosePerk(0);
    run.s.perks.sharpen = 200;
    run.refreshStats();
    play(run, (r) => r.s.floor === 1 && r.s.phase === 'perk');
    expect(run.s.phase).toBe('perk');
    expect(run.s.perkReason).toBe('floor');
    expect(run.s.perkChoices).toHaveLength(3);
    run.choosePerk(1);
    expect(run.s.floor).toBe(2);
    expect(run.s.blocks.length).toBeGreaterThan(0);
  });

  it('plays through the floor 10 boss, banks loot, and carries on', () => {
    const run = new Run(2024);
    run.choosePerk(0);
    run.s.perks.sharpen = 60;
    run.refreshStats();

    play(run, (r) => r.s.floor === 10 && r.s.phase === 'aim');
    expect(run.s.floor).toBe(10);
    const boss = run.s.blocks.find((b) => b.kind === 'boss')!;
    expect(boss).toBeDefined();
    expect(boss.w).toBe(3);
    expect(run.s.loot.banked).toBe(0);
    const atRisk = run.s.loot.coins;
    expect(atRisk).toBeGreaterThan(0);

    // Weaken the perks so the boss lives long enough to enter its shield phase.
    run.s.perks.sharpen = 20;
    run.refreshStats();
    run.s.hero.hp = run.s.hero.maxHp = 1e6;
    run.events = [];
    play(run, (r) => r.s.phase === 'perk');
    expect(run.s.stats.bossKills).toBe(1);
    expect(run.s.perkReason).toBe('boss');
    expect(run.events.some((e) => e.t === 'bossPhase')).toBe(true);
    expect(run.s.loot.banked).toBeGreaterThanOrEqual(atRisk);
    expect(run.s.loot.coins).toBe(0);
    expect(run.s.loot.gems).toBe(BOSS_GEMS);
    expect(run.s.blocks).toHaveLength(0);

    run.choosePerk(0);
    expect(run.s.floor).toBe(11);
    expect(run.payout().coins).toBe(run.s.loot.banked);
  });

  it('death, a single revive, then game over', () => {
    const run = emptyRun();
    run.s.hero.hp = 1;
    run.addBlock({ col: 3, row: 9, hp: 1e9 });
    run.addBlock({ col: 1, row: 4, hp: 1e9 });
    run.s.loot.coins = 100;
    run.endTurn();
    expect(run.s.phase).toBe('dead');
    expect(run.s.hero.hp).toBe(0);

    expect(run.revive()).toBe(true);
    expect(run.s.hero.hp).toBe(50);
    expect(run.s.blocks.every((b) => b.row <= 1)).toBe(true);
    expect(run.s.phase).toBe('resolve');

    run.s.hero.hp = 0;
    run.s.phase = 'dead';
    expect(run.revive()).toBe(false);
    run.end();
    expect(run.s.phase).toBe('over');
    expect(run.payout()).toEqual({ coins: 25, gems: 0, lost: 75 });
  });

  it('a frozen column backs up instead of overlapping', () => {
    const run = emptyRun();
    run.s.rowsLeft = 0;
    const low = run.addBlock({ col: 2, row: 5, hp: 1e9 })!;
    const high = run.addBlock({ col: 2, row: 4, hp: 1e9 })!;
    low.frozen = 2;
    run.endTurn();
    expect(low.row).toBe(5);
    expect(high.row).toBe(4);
    expect(run.grid.at(2, 5)).toBe(low);
    expect(run.grid.at(2, 4)).toBe(high);
  });
});
