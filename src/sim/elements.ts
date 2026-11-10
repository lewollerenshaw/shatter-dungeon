import type { Run } from './run';
import type { Block, Element } from './types';

/**
 * On-hit effect of an elemental orb. Runs after the hit's damage, and before
 * queued deaths resolve, so a killing blow still leaves its mark (a fire kill
 * explodes, a venom kill leaves a pool).
 */
export function applyElementHit(run: Run, el: Element, b: Block, dmg: number): void {
  const st = run.stats;
  switch (el) {
    case 'fire':
      b.burn += 1;
      break;
    case 'ice':
      addChill(run, b, 1);
      break;
    case 'lightning':
      run.chain(b, dmg * st.chainDmg, st.chainCount);
      break;
    case 'poison':
      b.poison += st.poisonStacks;
      break;
    case 'none':
      break;
  }
}

/** Chill stacks up to a freeze. Frozen-affix blocks are immune. */
export function addChill(run: Run, b: Block, n: number): void {
  if (b.dead || b.frozen > 0 || b.affixes.includes('frozen')) return;
  b.chill += n;
  if (b.chill >= run.stats.freezeAt) {
    b.chill = 0;
    b.frozen = 2;
    const [x, y] = run.center(b);
    run.emit({ t: 'freeze', id: b.id, x, y });
  }
}
