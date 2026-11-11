/**
 * The Weekly Tower: one seed a week, the same loadout for everyone, one life.
 * Because nothing about a tower run depends on the player's own profile, the
 * server can replay a submitted run and trust the result.
 */
import { metaAt, type MetaState } from './meta';
import { REPLAY_LIMITS, replay, type ReplayLimits } from './replay';
import { Run, type RunOptions } from './run';
import type { RunInput } from './types';

/**
 * Bump this whenever a change alters how any run plays out (physics, perks,
 * scaling, the tower loadout). Client and server refuse to talk across
 * versions, because a replay under different rules gives a different score.
 * tests/tower.test.ts holds a recorded run that fails when the rules drift.
 */
export const SIM_VERSION = 1;

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Monday 5 January 2026, 00:00 UTC: the start of week 1. */
export const TOWER_EPOCH = Date.UTC(2026, 0, 5);

export const towerWeek = (now: number): number => Math.max(1, Math.floor((now - TOWER_EPOCH) / WEEK_MS) + 1);

export const weekEndsAt = (week: number): number => TOWER_EPOCH + week * WEEK_MS;

/** The seed everyone plays in a given week. */
export function towerSeed(week: number): number {
  let h = (Math.imul(week | 0, 0x9e3779b1) ^ 0x5d0c7a3f) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** The loadout every tower run uses: a profile half way to fully upgraded. */
export const TOWER_META: MetaState = metaAt(0.5);

export interface TowerScore {
  floor: number;
  /** Blocks shattered. Breaks ties between runs that died on the same floor. */
  kills: number;
}

/** Positive if `a` ranks above `b`. */
export function compareScores(a: TowerScore, b: TowerScore): number {
  return a.floor - b.floor || a.kills - b.kills;
}

export type TowerVerdict = ({ ok: true; turns: number } & TowerScore) | { ok: false; error: string };

/** Replay a tower run for `week` and return the score it really earned. */
export function verifyTowerRun(week: number, log: readonly RunInput[], limits: ReplayLimits = REPLAY_LIMITS): TowerVerdict {
  const r = replay(towerSeed(week), TOWER_META, { tower: true }, log, limits);
  if (!r.ok) return r;
  if (!r.finished) return { ok: false, error: 'run not finished' };
  return { ok: true, floor: r.floor, kills: r.kills, turns: r.turns };
}

export const NAME_MIN = 3;
export const NAME_MAX = 16;

/** Tidy a display name, or null if nothing usable is left. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N} _.-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .trim();
  return name.length >= NAME_MIN ? name : null;
}

// ------------------------------------------------------------ reference run

/**
 * A fixed, mechanical player: it fires at angles from a formula and takes
 * perks by turn number. `variant` shifts the pattern to give different runs.
 * It plays in uneven frame-sized chunks and recalls now and then, the way a
 * real session does. Used for the reference run below and by the tests.
 */
export function scriptedRun(seed: number, meta: MetaState, opts: RunOptions, variant = 0, maxTurns = 400): Run {
  const run = new Run(seed, meta, opts);
  run.silent = true;
  const s = run.s;
  const firing = (): boolean => run.s.phase === 'firing';
  let turn = 0;
  let picks = 0;
  while (s.phase !== 'dead' && turn < maxTurns) {
    if (s.phase === 'perk') {
      if (s.rerolls > 0 && picks % 3 === 1) run.rerollPerks();
      run.choosePerk((picks + variant) % s.perkChoices!.length);
      picks++;
    } else if (s.phase === 'aim') {
      run.fire(0.45 + ((turn * 0.37 + variant * 0.11) % 2.2));
      turn++;
      let frames = 0;
      while (firing()) {
        run.update((1 + (frames % 3)) / 60);
        frames++;
        if ((turn + variant) % 5 === 0 && frames === 40) run.recall();
      }
    } else {
      run.update(1 / 60);
    }
  }
  // Stopped by the turn limit: let the last turn finish resolving.
  while (run.s.phase === 'resolve') run.update(1 / 60);
  return run;
}

/**
 * What the scripted player scores on a fixed seed under the current rules.
 * If a change to the simulation moves these numbers, old replays no longer
 * hold: update them and bump SIM_VERSION.
 */
export const REFERENCE = { seed: 20260105, floor: 14, kills: 338, ticks: 37180 };

let referenceOk: boolean | null = null;

/**
 * True if this JavaScript engine plays the reference run exactly as recorded.
 * A device that does not would have its tower scores rejected by the server,
 * so the game checks before offering to post them.
 */
export function simMatchesReference(): boolean {
  if (referenceOk === null) {
    const r = scriptedRun(REFERENCE.seed, TOWER_META, { tower: true }).s;
    referenceOk = r.floor === REFERENCE.floor && r.stats.kills === REFERENCE.kills && r.ticks === REFERENCE.ticks;
  }
  return referenceOk;
}
