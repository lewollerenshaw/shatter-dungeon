import { describe, expect, it } from 'vitest';
import { BASE_DMG } from '../src/sim/types';
import { UP, emptyRun, mkBall } from './helpers';

describe('elements', () => {
  it('fire: hits burn, burn ticks at end of turn, burning deaths explode', () => {
    const run = emptyRun();
    const a = run.addBlock({ col: 3, row: 3, hp: 100 })!;
    run.hitBlock(mkBall('fire'), a, UP);
    expect(a.hp).toBe(100 - BASE_DMG);
    expect(a.burn).toBe(1);
    run.endTurn();
    expect(a.hp).toBeCloseTo(100 - BASE_DMG - BASE_DMG * 0.5);

    const run2 = emptyRun();
    const victim = run2.addBlock({ col: 3, row: 3, hp: 1 })!;
    const near = run2.addBlock({ col: 4, row: 3, hp: 100 })!;
    const far = run2.addBlock({ col: 6, row: 3, hp: 100 })!;
    run2.hitBlock(mkBall('fire'), victim, UP);
    expect(victim.dead).toBe(true);
    expect(near.hp).toBeLessThan(100);
    expect(near.burn).toBe(1);
    expect(far.hp).toBe(100);
    expect(run2.events.some((e) => e.t === 'explode')).toBe(true);
  });

  it('fire explosions chain through a line of burning blocks', () => {
    const run = emptyRun();
    const blocks = [0, 1, 2, 3, 4].map((col) => run.addBlock({ col, row: 2, hp: 2 })!);
    for (const b of blocks) b.burn = 3;
    run.hitBlock(mkBall('fire'), blocks[0], UP);
    expect(blocks.every((b) => b.dead)).toBe(true);
    expect(run.s.stats.kills).toBe(5);
  });

  it('ice: three hits freeze, a frozen block skips a descent and takes bonus damage', () => {
    const run = emptyRun();
    const b = run.addBlock({ col: 2, row: 2, hp: 1000 })!;
    const other = run.addBlock({ col: 5, row: 2, hp: 1000 })!;
    const ball = mkBall('ice');
    run.hitBlock(ball, b, UP);
    run.hitBlock(ball, b, UP);
    expect(b.frozen).toBe(0);
    run.hitBlock(ball, b, UP);
    expect(b.frozen).toBe(2);
    const before = b.hp;
    run.hitBlock(mkBall(), b, UP);
    expect(before - b.hp).toBeCloseTo(BASE_DMG * 1.5);

    run.endTurn();
    expect(b.row).toBe(2);
    expect(other.row).toBe(3);
    run.endTurn();
    expect(b.row).toBe(3);
    expect(b.frozen).toBe(0);
  });

  it('lightning: arcs to the two nearest blocks for half damage', () => {
    const run = emptyRun();
    const src = run.addBlock({ col: 3, row: 3, hp: 100 })!;
    const n1 = run.addBlock({ col: 4, row: 3, hp: 100 })!;
    const n2 = run.addBlock({ col: 3, row: 4, hp: 100 })!;
    const n3 = run.addBlock({ col: 5, row: 3, hp: 100 })!;
    const far = run.addBlock({ col: 0, row: 9, hp: 100 })!;
    run.hitBlock(mkBall('lightning'), src, UP);
    expect(src.hp).toBe(100 - BASE_DMG);
    expect(n1.hp).toBe(100 - BASE_DMG / 2);
    expect(n2.hp).toBe(100 - BASE_DMG / 2);
    expect(n3.hp).toBe(100);
    expect(far.hp).toBe(100);
    expect(run.events.filter((e) => e.t === 'chain')).toHaveLength(2);
  });

  it('poison: stacks, ticks every turn without fading, and kills leave a pool', () => {
    const run = emptyRun();
    const b = run.addBlock({ col: 3, row: 1, hp: 100 })!;
    const ball = mkBall('poison');
    run.hitBlock(ball, b, UP);
    run.hitBlock(ball, b, UP);
    expect(b.poison).toBe(2);
    const hp = b.hp;
    run.endTurn();
    expect(hp - b.hp).toBeCloseTo(BASE_DMG * 0.35 * 2);
    expect(b.poison).toBe(2);

    const run2 = emptyRun();
    const low = run2.addBlock({ col: 3, row: 3, hp: 1 })!;
    const above = run2.addBlock({ col: 3, row: 2, hp: 100 })!;
    run2.hitBlock(mkBall('poison'), low, UP);
    expect(low.dead).toBe(true);
    expect(run2.s.pools).toHaveLength(1);
    run2.endTurn();
    // The block above stepped down into the pool.
    expect(above.row).toBe(3);
    expect(above.poison).toBe(2);
  });
});

describe('affixes', () => {
  it('reflective: ignores the first hit each turn and speeds the orb up', () => {
    const run = emptyRun();
    const b = run.addBlock({ col: 3, row: 3, hp: 100, affixes: ['reflective'] })!;
    const ball = mkBall();
    run.hitBlock(ball, b, UP);
    expect(b.hp).toBe(100);
    expect(Math.hypot(ball.vx, ball.vy)).toBeCloseTo(840 * 1.2);
    run.hitBlock(ball, b, UP);
    expect(b.hp).toBe(100 - BASE_DMG);
    run.endTurn();
    expect(b.reflectReady).toBe(true);
    for (let i = 0; i < 10; i++) {
      b.reflectReady = true;
      run.hitBlock(ball, b, UP);
    }
    expect(ball.speedMul).toBeLessThanOrEqual(1.5);
  });

  it('splitter: dies into two half-health minis', () => {
    const run = emptyRun();
    const b = run.addBlock({ col: 3, row: 3, hp: 3, affixes: ['splitter'] })!;
    b.maxHp = 40;
    run.hitBlock(mkBall(), b, UP);
    expect(b.dead).toBe(true);
    const minis = run.s.blocks.filter((o) => o.kind === 'mini');
    expect(minis).toHaveLength(2);
    expect(minis.every((m) => m.hp === 20 && m.affixes.length === 0)).toBe(true);
    expect(minis.some((m) => m.col === 3 && m.row === 3)).toBe(true);
  });

  it('vampiric: heals itself and its neighbours at end of turn', () => {
    const run = emptyRun();
    const vamp = run.addBlock({ col: 3, row: 3, hp: 100, affixes: ['vampiric'] })!;
    const friend = run.addBlock({ col: 4, row: 3, hp: 100 })!;
    const stranger = run.addBlock({ col: 0, row: 0, hp: 100 })!;
    vamp.hp = friend.hp = stranger.hp = 50;
    run.endTurn();
    expect(vamp.hp).toBe(65);
    expect(friend.hp).toBe(60);
    expect(stranger.hp).toBe(50);
  });

  it('frozen: ice armour absorbs hits, fire melts it faster, and it cannot be chilled', () => {
    const run = emptyRun();
    const b = run.addBlock({ col: 3, row: 3, hp: 100, affixes: ['frozen'] })!;
    expect(b.armor).toBe(3);
    const ball = mkBall('ice');
    for (let i = 0; i < 3; i++) run.hitBlock(ball, b, UP);
    expect(b.hp).toBe(100);
    expect(b.armor).toBe(0);
    for (let i = 0; i < 5; i++) run.hitBlock(ball, b, UP);
    expect(b.hp).toBe(100 - BASE_DMG * 5);
    expect(b.frozen).toBe(0);

    const c = run.addBlock({ col: 5, row: 3, hp: 100, affixes: ['frozen'] })!;
    run.hitBlock(mkBall('fire'), c, UP);
    expect(c.armor).toBe(1);
  });

  it('shielded: the shield soaks damage first and regrows if left alone', () => {
    const run = emptyRun();
    const b = run.addBlock({ col: 3, row: 3, hp: 100, affixes: ['shielded'] })!;
    expect(b.shield).toBe(50);
    run.hitBlock(mkBall(), b, UP);
    expect(b.shield).toBe(50 - BASE_DMG);
    expect(b.hp).toBe(100);
    run.endTurn(); // touched this turn: no regrowth
    expect(b.shield).toBe(50 - BASE_DMG);
    run.endTurn(); // untouched: back to full
    expect(b.shield).toBe(50);

    b.shield = 1;
    run.hitBlock(mkBall(), b, UP);
    expect(b.shield).toBe(0);
    expect(b.hp).toBe(100 - (BASE_DMG - 1));
    expect(run.events.some((e) => e.t === 'shieldBreak')).toBe(true);
  });
});

describe('turn resolution', () => {
  it('blocks step down each turn and hurt the hero when they reach the line', () => {
    const run = emptyRun();
    run.s.rowsLeft = 0;
    const b = run.addBlock({ col: 3, row: 8, hp: 1000 })!;
    run.endTurn();
    expect(b.row).toBe(9);
    expect(run.s.hero.hp).toBe(100);
    run.s.rowsLeft = 1;
    run.endTurn();
    expect(b.dead).toBe(true);
    expect(run.s.hero.hp).toBeLessThan(100);
  });

  it('crits use the crit multiplier and combo counts every bounce', () => {
    const run = emptyRun();
    run.stats.critChance = 1;
    const b = run.addBlock({ col: 3, row: 3, hp: 100 })!;
    run.hitBlock(mkBall(), b, UP);
    run.hitBlock(mkBall(), b, UP);
    expect(b.hp).toBe(100 - BASE_DMG * 2 * 2);
    expect(run.s.combo).toBe(2);
    expect(run.s.stats.crits).toBe(2);
  });
});
