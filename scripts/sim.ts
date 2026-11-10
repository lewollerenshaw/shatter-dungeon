/**
 * Headless balance bot.
 *
 *   npm run sim              40 runs, 5 candidate angles per turn
 *   npm run sim -- 100 12    100 runs, 12 candidate angles
 *
 * Each turn the bot clones the run, tries a fan of angles, and takes the one
 * with the best outcome. It picks perks at random. It never revives.
 */
import { PERK_BY_ID } from '../src/sim/perks';
import { Run } from '../src/sim/run';
import { rand } from '../src/sim/rng';
import { blockHp, breachDamage } from '../src/sim/scaling';
import { MIN_AIM } from '../src/sim/types';

const RUNS = Number(process.argv[2] ?? 40);
const ANGLES = Number(process.argv[3] ?? 5);
const MAX_FLOOR = 60;

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

interface Result {
  floor: number;
  turns: number;
  longestTurn: number;
  turnTime: number;
  stalled: number;
  perks: Record<string, number>;
  orbs: number;
}

function playRun(seed: number): Result {
  const run = new Run(seed);
  run.silent = true;
  const bot = { rng: seed ^ 0x9e3779b9 };
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
      for (let i = 0; i < ANGLES; i++) {
        const a = MIN_AIM + ((Math.PI - 2 * MIN_AIM) * (i + 0.5)) / ANGLES;
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
  };
}

const q = (sorted: number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

const started = Date.now();
const results: Result[] = [];
for (let i = 0; i < RUNS; i++) results.push(playRun(1000 + i * 7919));

const floors = results.map((r) => r.floor).sort((a, b) => a - b);
const turns = results.map((r) => r.turns).sort((a, b) => a - b);
console.log(`\n${RUNS} runs, ${ANGLES} angles/turn, ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(
  `death floor   p10 ${q(floors, 0.1)}   median ${q(floors, 0.5)}   p90 ${q(floors, 0.9)}   max ${floors[floors.length - 1]}`,
);
console.log(`turns per run median ${q(turns, 0.5)}`);
console.log(`reached boss (floor 10+): ${((100 * floors.filter((f) => f >= 10).length) / RUNS).toFixed(0)}%`);
console.log(`beat boss   (floor 11+): ${((100 * floors.filter((f) => f >= 11).length) / RUNS).toFixed(0)}%`);
console.log(
  `average turn ${(results.reduce((n, r) => n + r.turnTime, 0) / results.reduce((n, r) => n + r.turns, 0)).toFixed(1)}s sim-time`,
);
console.log(`longest turn ${Math.max(...results.map((r) => r.longestTurn)).toFixed(1)}s sim-time`);
console.log(`turns that hit the stall limit: ${results.reduce((n, r) => n + r.stalled, 0)}`);

const hist = new Map<number, number>();
for (const f of floors) hist.set(f, (hist.get(f) ?? 0) + 1);
console.log('\ndeaths by floor');
for (const [f, n] of [...hist].sort((a, b) => a[0] - b[0])) console.log(`${String(f).padStart(4)} ${'#'.repeat(n)}`);

// Which perks do long runs hold? A rough read on what is over- or under-powered.
const byPerk = new Map<string, { n: number; floorSum: number }>();
for (const r of results) {
  for (const id of Object.keys(r.perks)) {
    const e = byPerk.get(id) ?? { n: 0, floorSum: 0 };
    e.n++;
    e.floorSum += r.floor;
    byPerk.set(id, e);
  }
}
const never = Object.keys(PERK_BY_ID).filter((id) => !byPerk.has(id));
console.log('\naverage death floor of runs holding each perk');
for (const [id, e] of [...byPerk].sort((a, b) => b[1].floorSum / b[1].n - a[1].floorSum / a[1].n)) {
  console.log(`${id.padEnd(16)} ${(e.floorSum / e.n).toFixed(1).padStart(5)}  (${e.n} runs)`);
}
console.log(never.length ? `\nnever picked: ${never.join(', ')}` : '\nevery perk was picked at least once');
