/**
 * Fill this week's local leaderboard with bot runs, so there is something to
 * climb against while testing. The bots play real runs and submit them the
 * same way the game does, so this also exercises the server's replay check.
 *
 *   npm run server          (in another terminal)
 *   npm run seed:tower      8 bots
 *   npm run seed:tower -- 5 http://localhost:8787
 */
import { SIM_VERSION, TOWER_META, towerSeed, towerWeek } from '../src/sim/tower';
import { playRun } from './bot';

const COUNT = Math.min(10, Number(process.argv[2] ?? 8));
const BASE = process.argv[3] ?? 'http://localhost:8787';
const NAMES = ['Ember', 'Frost', 'Storm', 'Venom', 'Prism', 'Shard', 'Glint', 'Quartz', 'Onyx', 'Flint'];

const week = towerWeek(Date.now());
console.log(`week ${week}, seed ${towerSeed(week)}, ${COUNT} bots -> ${BASE}`);
for (let i = 0; i < COUNT; i++) {
  // Fewer candidate angles makes a weaker bot, which spreads the scores out.
  const angles = 1 + (i % 5);
  const r = playRun(towerSeed(week), TOWER_META, angles, { tower: true }, 7000 + i * 31);
  if (!r.dead) {
    console.log(`bot ${i} did not finish, skipped`);
    continue;
  }
  const res = await fetch(`${BASE}/api/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      week,
      playerId: `bot-${String(i).padStart(8, '0')}`,
      name: `Bot ${NAMES[i % NAMES.length]}`,
      simVersion: SIM_VERSION,
      log: r.log,
    }),
  });
  const out = (await res.json()) as { ok: boolean; floor?: number; rank?: number; message?: string };
  console.log(
    out.ok
      ? `Bot ${NAMES[i % NAMES.length].padEnd(7)} played floor ${r.floor}, server says floor ${out.floor}, rank ${out.rank}`
      : `Bot ${NAMES[i % NAMES.length]} rejected: ${out.message}`,
  );
}
