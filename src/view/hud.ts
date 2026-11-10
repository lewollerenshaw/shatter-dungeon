import type { Run } from '../sim/run';
import { LAUNCH_Y, W, type Element } from '../sim/types';
import { clamp, fmt } from '../util';
import type { Fx } from './fx';
import { EL_COLOR, FONT } from './palette';

function bar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  frac: number,
  color: string | CanvasGradient,
  back = 'rgba(255,255,255,0.09)',
): void {
  const r = h / 2;
  ctx.fillStyle = back;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
  const fw = Math.max(0, w * clamp(frac, 0, 1));
  if (fw > 0.5) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, Math.max(fw, h), h, r);
    ctx.fill();
  }
}

/** In-game heads-up display, drawn on the canvas after the bloom pass. */
export function drawHud(ctx: CanvasRenderingContext2D, run: Run, fx: Fx, time: number): void {
  const s = run.s;
  ctx.save();
  ctx.textBaseline = 'middle';

  // Floor and run coins. The top-right corner is left for the sound button.
  ctx.textAlign = 'left';
  ctx.font = `800 20px ${FONT}`;
  ctx.fillStyle = '#e9ecff';
  ctx.fillText(`FLOOR ${s.floor}`, 16, 24);
  ctx.textAlign = 'right';
  ctx.font = `700 15px ${FONT}`;
  ctx.fillStyle = '#ffd45e';
  ctx.fillText(`◆ ${fmt(s.loot.coins + s.loot.banked)}`, W - 62, 24);

  // Hero health.
  const hpFrac = s.hero.hp / s.hero.maxHp;
  const low = hpFrac < 0.3;
  const grad = ctx.createLinearGradient(16, 0, W - 16, 0);
  grad.addColorStop(0, '#ff4d6d');
  grad.addColorStop(1, low ? '#ff4d6d' : '#ff9e5e');
  ctx.globalAlpha = low ? 0.7 + 0.3 * Math.sin(time * 9) : 1;
  bar(ctx, 16, 42, W - 32, 14, hpFrac, grad);
  ctx.globalAlpha = 1;
  if (s.wards > 0) {
    // Ward talent: the next breach on this floor is absorbed.
    ctx.strokeStyle = '#9fe8ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(13.5, 39.5, W - 27, 19, 9.5);
    ctx.stroke();
  }
  ctx.textAlign = 'center';
  ctx.font = `800 10.5px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`${Math.ceil(s.hero.hp)} / ${s.hero.maxHp}`, W / 2, 49.5);

  // Boss health, or how many rows the floor still has to send.
  const boss = s.blocks.find((b) => b.kind === 'boss');
  ctx.font = `800 10px ${FONT}`;
  ctx.textAlign = 'left';
  if (boss) {
    ctx.fillStyle = '#ff6b8f';
    ctx.fillText('BOSS', 16, 75);
    bar(ctx, 52, 70, W - 68, 10, boss.hp / boss.maxHp, '#ff3b6b');
    if (boss.shield > 0 && boss.maxShield > 0) {
      // Shield sits as a thin strip above the health bar.
      bar(ctx, 52, 64, W - 68, 4, boss.shield / boss.maxShield, '#9fe8ff', 'rgba(159,232,255,0.15)');
    }
  } else if (s.rowsTotal > 0) {
    ctx.fillStyle = '#8b90b8';
    ctx.fillText('ROWS LEFT', 16, 75);
    const n = s.rowsTotal;
    const pw = Math.min(16, (W - 100 - 16) / n - 3);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i < s.rowsLeft ? '#5ee6ff' : 'rgba(94,230,255,0.16)';
      ctx.beginPath();
      ctx.roundRect(84 + i * (pw + 3), 71, pw, 8, 2.5);
      ctx.fill();
    }
  }

  // Orb count under the launcher.
  const waiting = s.phase === 'firing' ? s.volley.length - s.toLaunch : s.orbs.length;
  if (waiting > 0) {
    ctx.textAlign = 'center';
    ctx.font = `800 12px ${FONT}`;
    ctx.fillStyle = '#e9ecff';
    ctx.fillText(`×${waiting}`, clamp(s.launchX, 20, W - 20), LAUNCH_Y + 24);
  }

  // Loadout: one dot per orb, coloured by element.
  const counts = new Map<Element, number>();
  for (const el of s.orbs) counts.set(el, (counts.get(el) ?? 0) + 1);
  let ox = 16;
  ctx.textAlign = 'left';
  ctx.font = `800 12px ${FONT}`;
  for (const [el, n] of counts) {
    ctx.fillStyle = EL_COLOR[el];
    ctx.beginPath();
    ctx.arc(ox + 5, 742, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c9cdee';
    const label = String(n);
    ctx.fillText(label, ox + 14, 742.5);
    ox += 22 + ctx.measureText(label).width;
  }

  // Combo counter.
  if (s.phase === 'firing' && s.combo > 1) {
    const pop = 1 + fx.comboPop * 0.18;
    const heat = clamp(s.combo / 150, 0, 1);
    ctx.textAlign = 'center';
    ctx.font = `900 ${(20 * pop).toFixed(1)}px ${FONT}`;
    ctx.fillStyle = `hsl(${190 - heat * 150} 100% 68%)`;
    ctx.fillText(`${s.combo}`, W / 2, 786);
    ctx.font = `800 9.5px ${FONT}`;
    ctx.fillStyle = '#8b90b8';
    ctx.fillText('COMBO', W / 2, 804);
  } else if (s.phase === 'aim' && s.stats.turns === 0) {
    ctx.textAlign = 'center';
    ctx.font = `700 13px ${FONT}`;
    ctx.fillStyle = `rgba(233,236,255,${0.55 + 0.3 * Math.sin(time * 3)})`;
    ctx.fillText('Drag to aim, release to fire', W / 2, 790);
  }
  ctx.restore();
}
