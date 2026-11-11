/**
 * Plays a whole career on one profile, to show how long the progression lasts.
 *
 *   npm run career             80 runs, 5 candidate angles per turn
 *   npm run career -- 150 5    150 runs
 *
 * After every run the bot banks its coins and XP, buys the cheapest upgrade it
 * can afford until it runs dry, spends talent points row by row, opens the
 * chests bosses dropped and merges its orbs. Once every upgrade is bought it
 * puts spare coins into Wooden Chests. It never spends gems.
 */
import {
  MAX_LEVEL,
  TALENTS,
  TOTAL_TALENT_RANKS,
  UPGRADES,
  buyUpgrade,
  canBuyUpgrade,
  learnTalent,
  levelInfo,
  spentPoints,
  upgradeCost,
  upgradeLevel,
} from '../src/sim/meta';
import { CHEST_IDS, ORB_TYPES, mergeAll, orbLevel } from '../src/sim/orbs';
import { buyChest, newWallet, openChest, runMeta, settleRun } from '../src/sim/store';
import { playRun } from './bot';

const RUNS = Number(process.argv[2] ?? 80);
const ANGLES = Number(process.argv[3] ?? 5);
const EVERY = 5;

const profile = newWallet(0, 20261110);
const totalLevels = UPGRADES.reduce((n, u) => n + u.max, 0);
const bought = (): number => UPGRADES.reduce((n, u) => n + upgradeLevel(profile, u.id), 0);
const talentOrder = [...TALENTS].sort((a, b) => a.tier - b.tier || a.branch - b.branch);

function spend(): void {
  for (;;) {
    const affordable = UPGRADES.filter((u) => canBuyUpgrade(profile, u.id));
    if (affordable.length === 0) break;
    affordable.sort((a, b) => upgradeCost(a, upgradeLevel(profile, a.id)) - upgradeCost(b, upgradeLevel(profile, b.id)));
    buyUpgrade(profile, affordable[0].id);
  }
  while (talentOrder.some((t) => learnTalent(profile, t.id))) {
    // keep learning until no talent is ready
  }
  if (bought() === totalLevels) while (buyChest(profile, 'wood'));
  for (const id of CHEST_IDS) while (openChest(profile, id));
  mergeAll(profile.inv);
}

const orbs = (): string => ORB_TYPES.map((el) => orbLevel(profile.inv, el)).join(' ');

console.log(`\ncareer of ${RUNS} runs, ${ANGLES} angles/turn`);
console.log(' runs   avg floor   coins/run   level   upgrades   talents   orb levels');
let floors = 0;
let coins = 0;
let upgradesDone = 0;
let talentsDone = 0;
const started = Date.now();
for (let i = 1; i <= RUNS; i++) {
  const r = playRun(5000 + i * 104729, runMeta(profile), ANGLES);
  settleRun(profile, { coins: r.coins, gems: 0, floor: r.floor, bossKills: r.bossKills }, 0);
  floors += r.floor;
  coins += r.coins;
  spend();
  if (!upgradesDone && bought() === totalLevels) upgradesDone = i;
  if (!talentsDone && spentPoints(profile) === TOTAL_TALENT_RANKS) talentsDone = i;
  if (i % EVERY === 0 || i === RUNS) {
    const n = i % EVERY === 0 ? EVERY : i % EVERY;
    console.log(
      `${String(i).padStart(5)}   ${(floors / n).toFixed(1).padStart(9)}   ${String(Math.round(coins / n)).padStart(9)}   ${String(levelInfo(profile.xp).level).padStart(5)}   ${`${bought()}/${totalLevels}`.padStart(8)}   ${`${spentPoints(profile)}/${TOTAL_TALENT_RANKS}`.padStart(7)}   ${orbs()}`,
    );
    floors = 0;
    coins = 0;
  }
}
console.log(`\n${((Date.now() - started) / 1000).toFixed(0)}s`);
console.log(upgradesDone ? `every upgrade bought after run ${upgradesDone}` : `upgrades not finished: ${bought()}/${totalLevels} levels`);
console.log(talentsDone ? `talent tree full after run ${talentsDone}` : `talent tree not full: level ${levelInfo(profile.xp).level}/${MAX_LEVEL}`);
