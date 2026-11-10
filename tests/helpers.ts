import { Run } from '../src/sim/run';
import type { Contact } from '../src/sim/physics';
import { BALL_RADIUS, type Ball, type Element } from '../src/sim/types';

/** A run past the starter choice with an empty board and no crits. */
export function emptyRun(seed = 1): Run {
  const run = new Run(seed);
  run.choosePerk(0);
  run.s.orbs = ['none'];
  run.s.blocks = [];
  run.s.rowsLeft = 3;
  run.grid.clear();
  run.s.phase = 'aim';
  run.stats.critChance = 0;
  run.drainEvents();
  return run;
}

export function mkBall(element: Element = 'none'): Ball {
  return {
    id: 999,
    x: 100,
    y: 300,
    vx: 0,
    vy: -840,
    r: BALL_RADIUS,
    element,
    temp: false,
    bounces: 0,
    pierce: 0,
    ghostId: 0,
    recalled: false,
    speedMul: 1,
    done: false,
  };
}

export const UP: Contact = { nx: 0, ny: 1, depth: 1 };

/** Run the sim until the current volley and its resolution are over. */
export function finishTurn(run: Run): void {
  let guard = 0;
  while ((run.s.phase === 'firing' || run.s.phase === 'resolve') && guard++ < 20000) run.update(1 / 30);
}
