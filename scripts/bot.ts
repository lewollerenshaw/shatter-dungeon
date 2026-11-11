/**
 * The balance bot. Each turn it clones the run, tries a fan of angles, and
 * takes the one with the best outcome. It picks perks at random and never
 * revives or rerolls.
 */
import type { MetaState } from '../src/sim/meta';
import { xpForRun } from '../src/sim/meta';
import { Run, type RunOptions } from '../src/sim/run';
import { rand } from '../src/sim/rng';
import { blockHp, breachDamage } from '../src/sim/scaling';
import { MIN_AIM, type RunInput } from '../src/sim/types';

export const MAX_FLOOR = 60;

function finishTurn(run: Run): void {
  let guard = 0;
  while ((run.s.phase === 'firing' || run.s.phase === 'resolve') && guard++ < 40000) run.update(1 / 30);
}

function score(before: Run, after: Run): number {
  const f = before.s.floor;
  const dmg = (after.s.stats.damage - before.s.stats.damage) / blockHp(f);
  const kills = after.s.stats.kills - before.s.stats.kills;
  const hurt = (before.s.hero.hp - after.s.hero.hp) / breachDamage(f);
  let danger = 0;
  for (const b of after.s.blocks) danger += Math.max(0, b.row + b.h - 6) ** 2;
  const cleared = after.s.floor > f || after.s.phase === 'perk' ? 20 : 0;
  return dmg + kills * 2 - hurt * 25 - danger * 0.6 + cleared;
}

export interface Result {
  floor: number;
  turns: number;
  longestTurn: number;
  turnTime: number;
  stalled: number;
  perks: Record<string, number>;
  orbs: number;
  coins: number;
  xp: number;
  bossKills: number;
  kills: number;
  dead: boolean;
  /** Everything the bot did, replayable with src/sim/replay.ts. */
  log: RunInput[];
}

/** `botSeed` drives the bot's own choices (perk picks), separately from the run's seed. */
export function playRun(seed: number, meta: MetaState, angles: number, opts: RunOptions = {}, botSeed = seed): Result {
  const run = new Run(seed, meta, opts);
  run.silent = true;
  const bot = { rng: botSeed ^ 0x9e3779b9 };
  let longestTurn = 0;
  let stalled = 0;
  let turnTime = 0;
  while (run.s.phase !== 'dead' && run.s.floor <= MAX_FLOOR) {
    const p = run.s.phase;
    if (p === 'perk') {
      run.choosePerk(Math.floor(rand(bot) * run.s.perkChoices!.length));
    } else if (p === 'aim') {
      let best = Math.PI / 2;
      let bestScore = -Infinity;
      for (let i = 0; i < angles; i++) {
        const a = MIN_AIM + ((Math.PI - 2 * MIN_AIM) * (i + 0.5)) / angles;
        const trial = new Run(structuredClone(run.s));
        trial.silent = true;
        trial.fire(a);
        finishTurn(trial);
        const sc = score(run, trial);
        if (sc > bestScore) {
          bestScore = sc;
          best = a;
        }
      }
      run.fire(best);
      let t = 0;
      while (run.s.phase === 'firing') {
        run.update(1 / 30);
        t = run.s.turnTime;
        if (t > longestTurn) longestTurn = t;
      }
      turnTime += t;
      if (t >= 29.9) stalled++;
    } else {
      finishTurn(run);
    }
  }
  return {
    floor: run.s.floor,
    turns: run.s.stats.turns,
    longestTurn,
    turnTime,
    stalled,
    perks: run.s.perks,
    orbs: run.s.orbs.length,
    coins: run.payout().coins,
    xp: xpForRun(run.s.floor, run.s.stats.bossKills),
    bossKills: run.s.stats.bossKills,
    kills: run.s.stats.kills,
    dead: run.s.phase === 'dead',
    log: run.log,
  };
}
