/**
 * Re-run a recorded run from its seed, profile and input log. The simulation
 * is deterministic, so this reproduces the original run exactly. The
 * leaderboard server uses it to work out a score itself instead of trusting
 * the number a client sends.
 */
import type { MetaState } from './meta';
import { Run, type RunOptions } from './run';
import type { RunInput } from './types';

export interface ReplayLimits {
  /** Most inputs a log may hold. */
  maxInputs: number;
  /** Most fixed steps to simulate before giving up. */
  maxSteps: number;
}

/** Generous for a real run (a long one is about 300,000 steps) while capping the CPU a bad log can burn at a few seconds. */
export const REPLAY_LIMITS: ReplayLimits = { maxInputs: 6000, maxSteps: 1_200_000 };

export type ReplayResult =
  | {
      ok: true;
      /** The run ended with the hero dead. False means the log stops mid-run. */
      finished: boolean;
      floor: number;
      kills: number;
      turns: number;
      damage: number;
      run: Run;
    }
  | { ok: false; error: string };

const fail = (error: string): ReplayResult => ({ ok: false, error });

/** True if `x` has the shape of a log entry. Says nothing about whether it is legal in context. */
export function isRunInput(x: unknown): x is RunInput {
  if (!Array.isArray(x)) return false;
  switch (x[0]) {
    case 'f':
      return x.length === 2 && typeof x[1] === 'number' && Number.isFinite(x[1]);
    case 'p':
    case 'c':
      return x.length === 2 && Number.isSafeInteger(x[1]) && x[1] >= 0;
    case 'r':
    case 'v':
      return x.length === 1;
    default:
      return false;
  }
}

export function replay(
  seed: number,
  meta: MetaState,
  opts: RunOptions,
  log: readonly RunInput[],
  limits: ReplayLimits = REPLAY_LIMITS,
): ReplayResult {
  if (log.length > limits.maxInputs) return fail('log too long');
  const run = new Run(seed, meta, opts);
  run.silent = true;
  const s = run.s;
  let i = 0;
  let steps = 0;

  for (;;) {
    // Let the simulation run until it needs the player, applying timed recalls on the way.
    while (s.phase === 'firing' || s.phase === 'resolve') {
      const next = log[i];
      if (s.phase === 'firing' && next && next[0] === 'c') {
        if (next[1] < s.ticks) return fail('recall out of order');
        if (next[1] === s.ticks) {
          const before = run.log.length;
          run.recall();
          if (run.log.length === before) return fail('recall had no effect');
          i++;
          continue;
        }
      }
      if (++steps > limits.maxSteps) return fail('run too long');
      run.step();
    }
    if (i >= log.length) break;

    const input = log[i++];
    let legal: boolean;
    switch (input[0]) {
      case 'f':
        legal = Number.isFinite(input[1]) && run.fire(input[1]);
        break;
      case 'p':
        legal = run.choosePerk(input[1]);
        break;
      case 'r':
        legal = run.rerollPerks();
        break;
      case 'v':
        legal = run.revive();
        break;
      default:
        // A recall while nothing is in flight.
        legal = false;
    }
    if (!legal) return fail(`illegal input ${i - 1}`);
  }

  return {
    ok: true,
    finished: s.phase === 'dead' || s.phase === 'over',
    floor: s.floor,
    kills: s.stats.kills,
    turns: s.stats.turns,
    damage: s.stats.damage,
    run,
  };
}
