import { describe, expect, it } from 'vitest';
import { Grid, MIN_VERTICAL, circleRect, fixAngle, moveBall, traceAim, type Contact } from '../src/sim/physics';
import { Run } from '../src/sim/run';
import {
  BLOCK_PAD,
  CELL,
  COLS,
  FIELD_TOP,
  LAUNCH_Y,
  MIN_AIM,
  W,
  type Block,
} from '../src/sim/types';
import { emptyRun, finishTurn, mkBall } from './helpers';

const c: Contact = { nx: 0, ny: 0, depth: 0 };

describe('circleRect', () => {
  it('misses when apart', () => {
    expect(circleRect(0, 0, 5, 10, 10, 20, 20, c)).toBe(false);
  });

  it('gives a face normal on a side hit', () => {
    expect(circleRect(7, 15, 5, 10, 10, 20, 20, c)).toBe(true);
    expect(c.nx).toBeCloseTo(-1);
    expect(c.ny).toBeCloseTo(0);
    expect(c.depth).toBeCloseTo(2);
  });

  it('gives a diagonal normal on a corner hit', () => {
    expect(circleRect(8, 8, 5, 10, 10, 20, 20, c)).toBe(true);
    expect(c.nx).toBeCloseTo(-Math.SQRT1_2);
    expect(c.ny).toBeCloseTo(-Math.SQRT1_2);
  });

  it('pushes out along the shallowest axis when the centre is inside', () => {
    expect(circleRect(15, 11, 5, 10, 10, 20, 20, c)).toBe(true);
    expect(c.nx).toBe(0);
    expect(c.ny).toBe(-1);
    expect(c.depth).toBeCloseTo(6);
  });
});

describe('ball movement', () => {
  const noHooks = { hit: () => true, wall: () => {} };

  it('bounces off the side walls and ceiling', () => {
    const grid = new Grid();
    const ball = mkBall();
    ball.x = 20;
    ball.y = 300;
    ball.vx = -800;
    ball.vy = -200;
    for (let i = 0; i < 20; i++) moveBall(ball, 1 / 120, grid, noHooks);
    expect(ball.vx).toBeGreaterThan(0);
    expect(ball.x).toBeGreaterThanOrEqual(ball.r);

    ball.x = 200;
    ball.y = FIELD_TOP + 20;
    ball.vx = 0;
    ball.vy = -800;
    for (let i = 0; i < 20; i++) moveBall(ball, 1 / 120, grid, noHooks);
    expect(ball.vy).toBeGreaterThan(0);
  });

  it('reflects off a block face', () => {
    const run = emptyRun();
    const block = run.addBlock({ col: 3, row: 2, hp: 1e9 })!;
    const ball = mkBall();
    ball.x = (block.col + 0.5) * CELL;
    ball.y = FIELD_TOP + 5 * CELL;
    ball.vx = 0;
    ball.vy = -840;
    let hits = 0;
    const hooks = {
      hit: () => {
        hits++;
        return true;
      },
      wall: () => {},
    };
    for (let i = 0; i < 60 && hits === 0; i++) moveBall(ball, 1 / 120, run.grid, hooks);
    expect(hits).toBe(1);
    expect(ball.vy).toBeGreaterThan(0);
    expect(ball.y - ball.r).toBeGreaterThanOrEqual(FIELD_TOP + 3 * CELL - BLOCK_PAD - 1e-6);
  });

  it('never tunnels through a solid row, even at top speed', () => {
    const run = emptyRun();
    for (let col = 0; col < COLS; col++) run.addBlock({ col, row: 3, hp: 1e12 });
    const wallBottom = FIELD_TOP + 4 * CELL - BLOCK_PAD;
    const hooks = { hit: () => true, wall: () => {} };
    for (let k = 0; k < 60; k++) {
      const angle = MIN_AIM + ((Math.PI - 2 * MIN_AIM) * (k + 0.5)) / 60;
      const ball = mkBall();
      const speed = 840 * 1.5;
      ball.x = 20 + ((W - 40) * k) / 59;
      ball.y = LAUNCH_Y - 1;
      ball.vx = Math.cos(angle) * speed;
      ball.vy = -Math.sin(angle) * speed;
      for (let i = 0; i < 600; i++) {
        moveBall(ball, 1 / 120, run.grid, hooks);
        expect(ball.y + ball.r).toBeGreaterThan(wallBottom - 0.5);
        if (ball.y >= LAUNCH_Y && ball.vy > 0) break;
      }
    }
  });

  it('keeps a minimum vertical speed', () => {
    const ball = mkBall();
    ball.vx = 840;
    ball.vy = 1;
    fixAngle(ball);
    expect(Math.abs(ball.vy)).toBeCloseTo(840.0006 * MIN_VERTICAL, 1);
    expect(Math.hypot(ball.vx, ball.vy)).toBeCloseTo(Math.hypot(840, 1), 3);
  });

  it('pierces through a block and only hits it once', () => {
    const run = emptyRun();
    const block: Block = run.addBlock({ col: 3, row: 4, hp: 1e9 })!;
    const ball = mkBall();
    ball.x = (block.col + 0.5) * CELL;
    ball.y = FIELD_TOP + 7 * CELL;
    let hits = 0;
    const hooks = {
      hit: () => {
        hits++;
        return false;
      },
      wall: () => {},
    };
    for (let i = 0; i < 40; i++) moveBall(ball, 1 / 120, run.grid, hooks);
    expect(hits).toBe(1);
    expect(ball.y).toBeLessThan(FIELD_TOP + 4 * CELL);
    expect(ball.ghostId).toBe(0);
  });
});

describe('aim trace', () => {
  it('starts at the launcher and records the first bounce', () => {
    const run = emptyRun();
    run.addBlock({ col: 3, row: 5, hp: 100 });
    const pts = run.traceAim(Math.PI / 2);
    expect(pts[0].x).toBeCloseTo(run.s.launchX);
    expect(pts.length).toBeGreaterThanOrEqual(3);
    expect(pts[1].y).toBeLessThan(FIELD_TOP + 6 * CELL + 10);
    expect(pts[1].y).toBeGreaterThan(FIELD_TOP + 6 * CELL - 10);
  });

  it('does not disturb the board', () => {
    const run = emptyRun();
    const b = run.addBlock({ col: 3, row: 5, hp: 100 })!;
    traceAim(run.s.launchX, LAUNCH_Y - 1, 1.2, 7, run.grid);
    expect(b.hp).toBe(100);
    expect(run.s.combo).toBe(0);
  });
});

describe('determinism', () => {
  it('replays identically from the same seed and inputs', () => {
    const play = (seed: number): string => {
      const run = new Run(seed);
      run.silent = true;
      let turn = 0;
      while (turn < 25 && run.s.phase !== 'dead') {
        if (run.s.phase === 'perk') run.choosePerk(turn % 3);
        else if (run.s.phase === 'aim') run.fire(0.4 + ((turn++ * 0.37) % 2.3));
        else finishTurn(run);
      }
      return JSON.stringify(run.s);
    };
    expect(play(12345)).toBe(play(12345));
    expect(play(12345)).not.toBe(play(54321));
  });
});
