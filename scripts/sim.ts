/**
 * Headless balance bot.
 *
 *   npm run sim              40 runs, 5 candidate angles per turn
 *   npm run sim -- 100 12    100 runs, 12 candidate angles
 *   npm run sim -- 100 5 0.5 the same bot with a profile half way to fully upgraded
 *
 * Each turn the bot clones the run, tries a fan of angles, and takes the one
 * with the best outcome. It picks perks at random. It never revives.
 */
import { levelInfo, metaAt } from '../src/sim/meta';
import { PERK_BY_ID } from '../src/sim/perks';
import { playRun, type Result } from './bot';

const RUNS = Number(process.argv[2] ?? 40);
const ANGLES = Number(process.argv[3] ?? 5);
/** 0 = a brand new profile, 1 = every upgrade and talent maxed. */
const META = Number(process.argv[4] ?? 0);
const meta = metaAt(META);
// DROP=fallout,f_damage removes talents or upgrades from that profile, to see what each is worth.
for (const id of (process.env.DROP ?? '').split(',')) {
  delete meta.talents[id];
  delete meta.upgrades[id];
}

const q = (sorted: number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

const started = Date.now();
const results: Result[] = [];
for (let i = 0; i < RUNS; i++) results.push(playRun(1000 + i * 7919, meta, ANGLES));

const floors = results.map((r) => r.floor).sort((a, b) => a - b);
const turns = results.map((r) => r.turns).sort((a, b) => a - b);
console.log(`\n${RUNS} runs, ${ANGLES} angles/turn, profile ${(META * 100).toFixed(0)}% upgraded, ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(
  `death floor   p10 ${q(floors, 0.1)}   median ${q(floors, 0.5)}   p90 ${q(floors, 0.9)}   max ${floors[floors.length - 1]}`,
);
console.log(`turns per run median ${q(turns, 0.5)}`);
const coins = results.map((r) => r.coins).sort((a, b) => a - b);
const xps = results.map((r) => r.xp).sort((a, b) => a - b);
console.log(`coins kept    p10 ${q(coins, 0.1)}   median ${q(coins, 0.5)}   p90 ${q(coins, 0.9)}`);
console.log(`xp per run    median ${q(xps, 0.5)}   (level ${levelInfo(xps.reduce((n, x) => n + x, 0)).level} after all ${RUNS} runs)`);
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
