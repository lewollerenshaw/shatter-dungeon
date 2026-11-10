import type { BlockKind, DmgSrc, Element } from '../sim/types';
import { clamp } from '../util';

export const FONT = 'ui-rounded, "SF Pro Rounded", "Nunito", system-ui, -apple-system, "Segoe UI", sans-serif';

/** Six-digit hex only: the renderer appends alpha to these. */
export const EL_COLOR: Record<Element, string> = {
  none: '#dfe8ff',
  fire: '#ff7a2f',
  ice: '#6fe3ff',
  lightning: '#ffe24a',
  poison: '#7dff5a',
};

export const EL_NAME: Record<Element, string> = {
  none: 'Plain',
  fire: 'Fire',
  ice: 'Frost',
  lightning: 'Storm',
  poison: 'Venom',
};

/** Tougher blocks shift from cyan through violet to hot pink. */
export function blockHue(kind: BlockKind, hp: number, floorBase: number): number {
  if (kind === 'boss') return 348;
  if (kind === 'elite') return 44;
  const t = clamp(Math.log2(Math.max(hp, 1) / floorBase + 1) / 1.8, 0, 1);
  return 185 + t * 165;
}

export function damageColor(element: Element, src: DmgSrc): string {
  if (src === 'burn' || src === 'blast') return element === 'fire' ? EL_COLOR.fire : '#ffffff';
  if (src === 'poison') return EL_COLOR.poison;
  if (src === 'chain') return EL_COLOR.lightning;
  return element === 'none' ? '#ffffff' : EL_COLOR[element];
}
