import { pick, rand, shuffle } from './rng';
import type { Run } from './run';
import { SHIELD_FLOOR, affixChance, secondAffixChance } from './scaling';
import type { Affix, Block } from './types';

export function rollAffixes(run: Run, floor: number): Affix[] {
  const p = affixChance(floor);
  if (p <= 0 || rand(run.s) >= p) return [];
  const pool: Affix[] = ['reflective', 'splitter', 'vampiric', 'frozen'];
  if (floor >= SHIELD_FLOOR) pool.push('shielded');
  const first = pick(run.s, pool);
  const out: Affix[] = [first];
  if (rand(run.s) < secondAffixChance(floor)) {
    out.push(
      pick(
        run.s,
        pool.filter((a) => a !== first),
      ),
    );
  }
  return out;
}

/** End-of-turn upkeep: reflect resets, untouched shields regrow, vampires feed. */
export function endTurnAffixes(run: Run): void {
  const blocks = run.s.blocks;
  for (const b of blocks) {
    if (b.affixes.includes('reflective')) b.reflectReady = true;
    if (b.affixes.includes('shielded')) {
      if (!b.shieldHit && b.shield < b.maxShield) {
        b.shield = b.maxShield;
        const [x, y] = run.center(b);
        run.emit({ t: 'shieldUp', id: b.id, x, y });
      }
      b.shieldHit = false;
    }
  }
  for (const b of blocks) {
    if (!b.affixes.includes('vampiric')) continue;
    heal(run, b, b.maxHp * 0.15);
    for (const o of run.neighbours(b)) heal(run, o, o.maxHp * 0.1);
  }
}

function heal(run: Run, b: Block, amount: number): void {
  const gain = Math.min(b.maxHp - b.hp, Math.ceil(amount));
  if (gain <= 0) return;
  b.hp += gain;
  const [x, y] = run.center(b);
  run.emit({ t: 'heal', id: b.id, x, y, amount: gain });
}

/** Splitter: one half-health mini stays in the cell, another lands beside it. */
export function splitBlock(run: Run, b: Block): void {
  const hp = Math.max(1, Math.round(b.maxHp / 2));
  const spots = shuffle(run.s, [
    [b.col - 1, b.row],
    [b.col + 1, b.row],
    [b.col, b.row - 1],
  ]);
  const cells = [[b.col, b.row], ...spots];
  let made = 0;
  for (const [col, row] of cells) {
    if (made >= 2) break;
    if (!run.grid.isFree(col, row)) continue;
    if (run.addBlock({ kind: 'mini', col, row, hp, coins: Math.max(1, Math.floor(b.coins / 2)) })) made++;
  }
}
