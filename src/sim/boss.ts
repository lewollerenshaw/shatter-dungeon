import { rand, shuffle } from './rng';
import type { Run } from './run';
import { bossHp } from './scaling';
import { COLS, ROWS, type Block } from './types';

export const BOSS_SIZE = 3;

/** A 3x3 boss in the top centre with a few minions flanking it. */
export function spawnBoss(run: Run): Block | null {
  const boss = run.addBlock({
    kind: 'boss',
    col: Math.floor((COLS - BOSS_SIZE) / 2),
    row: 0,
    w: BOSS_SIZE,
    h: BOSS_SIZE,
    hp: bossHp(run.s.floor),
    coins: 40 + run.s.floor * 4,
  });
  for (const col of [0, 1, COLS - 2, COLS - 1]) {
    if (rand(run.s) < 0.6) run.spawnBlock(col, rand(run.s) < 0.5 ? 0 : 1, 'minion');
  }
  return boss;
}

/** The boss summons on the turns it does not move (it moves on even turns). */
export function bossAct(run: Run, boss: Block): void {
  if (run.s.turn % 2 === 1) summon(run, boss, 3);
}

/** At half health the boss raises a one-off shield and calls reinforcements. */
export function bossPhase(run: Run, boss: Block): void {
  boss.phased = true;
  boss.maxShield = Math.round(boss.maxHp * 0.15);
  boss.shield = boss.maxShield;
  run.emit({ t: 'bossPhase', id: boss.id });
  summon(run, boss, 4);
}

function summon(run: Run, boss: Block, count: number): void {
  const maxRow = Math.min(ROWS - 4, boss.row + boss.h);
  const free: [number, number][] = [];
  for (let r = 0; r <= maxRow; r++) {
    for (let c = 0; c < COLS; c++) if (run.grid.isFree(c, r)) free.push([c, r]);
  }
  shuffle(run.s, free);
  let made = 0;
  for (const [c, r] of free) {
    if (made >= count) break;
    if (run.spawnBlock(c, r, 'minion')) made++;
  }
  if (made > 0) run.emit({ t: 'summon' });
}
