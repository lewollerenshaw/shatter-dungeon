import type { Run } from '../sim/run';
import { blockHp } from '../sim/scaling';
import { CELL, FIELD_BOTTOM, FIELD_TOP, H, LAUNCH_Y, W, type BlockKind, type SimEvent } from '../sim/types';
import { fmt } from '../util';
import type { Sfx } from './audio';
import { EL_COLOR, FONT, blockHue, damageColor } from './palette';

interface Particle {
  kind: 'shard' | 'spark' | 'bubble';
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  rot: number;
  vr: number;
  grav: number;
}

interface Num {
  x: number;
  y: number;
  value: number;
  text: string | null;
  age: number;
  max: number;
  crit: boolean;
  color: string;
}

interface Ring {
  x: number;
  y: number;
  r: number;
  age: number;
  max: number;
  color: string;
  width: number;
}

interface Bolt {
  pts: number[];
  age: number;
  max: number;
}

interface Banner {
  text: string;
  sub: string;
  color: string;
  age: number;
  max: number;
}

/** Haptic tap. Browsers reject vibration before the first real touch, so check first. */
function buzz(pattern: number | number[]): void {
  const active = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (navigator.vibrate && (!active || active.hasBeenActive)) navigator.vibrate(pattern);
}

const MAX_PARTICLES = 700;
const MAX_NUMBERS = 70;

/** Everything that is purely for feel: particles, numbers, shake, banners. */
export class Fx {
  parts: Particle[] = [];
  nums: Num[] = [];
  rings: Ring[] = [];
  bolts: Bolt[] = [];
  banner: Banner | null = null;
  trauma = 0;
  hitStop = 0;
  redFlash = 0;
  whiteFlash = 0;
  /** Briefly pulses the combo counter. */
  comboPop = 0;

  private numByBlock = new Map<number, Num>();

  reset(): void {
    this.parts = [];
    this.nums = [];
    this.rings = [];
    this.bolts = [];
    this.banner = null;
    this.numByBlock.clear();
    this.trauma = this.hitStop = this.redFlash = this.whiteFlash = 0;
  }

  // ------------------------------------------------------------- spawners

  private part(p: Particle): void {
    if (this.parts.length < MAX_PARTICLES) this.parts.push(p);
  }

  sparks(x: number, y: number, color: string, n: number, speed = 220): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.35 + Math.random() * 0.9);
      const life = 0.18 + Math.random() * 0.25;
      this.part({ kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, size: 1.6 + Math.random() * 1.4, color, rot: 0, vr: 0, grav: 300 });
    }
  }

  private shards(x: number, y: number, w: number, h: number, color: string, n: number): void {
    for (let i = 0; i < n; i++) {
      const px = x + (Math.random() - 0.5) * w * CELL * 0.8;
      const py = y + (Math.random() - 0.5) * h * CELL * 0.8;
      const a = Math.atan2(py - y, px - x) + (Math.random() - 0.5);
      const v = 90 + Math.random() * 260;
      const life = 0.45 + Math.random() * 0.45;
      this.part({ kind: 'shard', x: px, y: py, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life, max: life, size: 3 + Math.random() * 6, color, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 16, grav: 700 });
    }
  }

  private bubbles(x: number, y: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const life = 0.5 + Math.random() * 0.5;
      this.part({ kind: 'bubble', x: x + (Math.random() - 0.5) * CELL * 0.7, y: y + (Math.random() - 0.5) * CELL * 0.5, vx: (Math.random() - 0.5) * 20, vy: -30 - Math.random() * 40, life, max: life, size: 2 + Math.random() * 3, color: EL_COLOR.poison, rot: 0, vr: 0, grav: 0 });
    }
  }

  ring(x: number, y: number, r: number, color: string, max = 0.35, width = 3): void {
    if (this.rings.length < 40) this.rings.push({ x, y, r, age: 0, max, color, width });
  }

  private bolt(x1: number, y1: number, x2: number, y2: number): void {
    if (this.bolts.length > 30) return;
    const pts = [x1, y1];
    const segs = 5;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      const off = (Math.random() - 0.5) * 16;
      pts.push(x1 + dx * t + (-dy / len) * off, y1 + dy * t + (dx / len) * off);
    }
    pts.push(x2, y2);
    this.bolts.push({ pts, age: 0, max: 0.16 });
  }

  /** Damage numbers on the same block merge instead of stacking up. */
  private number(blockId: number, x: number, y: number, value: number, crit: boolean, color: string): void {
    const prev = this.numByBlock.get(blockId);
    if (prev && prev.age < 0.3) {
      prev.value += value;
      prev.age = Math.min(prev.age, 0.06);
      prev.crit = prev.crit || crit;
      if (crit) prev.color = '#ffd45e';
      return;
    }
    if (this.nums.length >= MAX_NUMBERS) this.nums.shift();
    const n: Num = { x: x + (Math.random() - 0.5) * 14, y: y - 8, value, text: null, age: 0, max: 0.75, crit, color: crit ? '#ffd45e' : color };
    this.nums.push(n);
    this.numByBlock.set(blockId, n);
  }

  label(x: number, y: number, text: string, color: string, max = 0.9): void {
    if (this.nums.length >= MAX_NUMBERS) this.nums.shift();
    this.nums.push({ x, y, value: 0, text, age: 0, max, crit: false, color });
  }

  showBanner(text: string, sub: string, color: string, max = 1.5): void {
    this.banner = { text, sub, color, age: 0, max };
  }

  private blockColor(kind: BlockKind, maxHp: number, floor: number): string {
    return `hsl(${blockHue(kind, maxHp, blockHp(floor))} 95% 62%)`;
  }

  // --------------------------------------------------------------- events

  /**
   * Turn simulation events into feedback. `intensity` drops at high game
   * speed so fast-forwarded turns do not strobe.
   */
  handle(events: SimEvent[], run: Run, sfx: Sfx, bump: (id: number, flash: number, pop: number) => void, intensity: number): void {
    const floor = run.s.floor;
    for (const e of events) {
      switch (e.t) {
        case 'hit': {
          const color = damageColor(e.element, e.src);
          bump(e.id, e.crit ? 1 : 0.6, e.src === 'ball' ? 1 : 0.5);
          this.number(e.id, e.x, e.y, e.dmg, e.crit, color);
          if (e.src === 'ball') {
            this.sparks(e.x, e.y, color, e.crit ? 8 : 3);
            sfx.bounce(run.s.combo);
            this.comboPop = 1;
            if (e.crit) {
              sfx.crit();
              this.trauma += 0.1 * intensity;
              this.ring(e.x, e.y, 22, '#ffd45e', 0.25, 2);
            }
          }
          break;
        }
        case 'kill': {
          const color = this.blockColor(e.kind, e.maxHp, floor);
          const big = e.kind === 'boss';
          this.shards(e.x, e.y, e.w, e.h, color, big ? 70 : e.kind === 'elite' ? 20 : 11);
          this.ring(e.x, e.y, (Math.max(e.w, e.h) * CELL) / 2 + 10, color, 0.3, 2);
          this.trauma += (big ? 1 : e.kind === 'elite' ? 0.3 : 0.14) * intensity;
          if (big) {
            this.hitStop = 0.25;
            this.whiteFlash = 0.8;
            sfx.explode();
          } else if (intensity >= 1) {
            this.hitStop = Math.max(this.hitStop, 0.018);
          }
          sfx.kill();
          if (e.coins > 0 && e.kind !== 'minion' && e.kind !== 'mini') this.label(e.x, e.y + 6, `+${e.coins}`, '#ffd45e', 0.7);
          break;
        }
        case 'explode':
          this.ring(e.x, e.y, e.r, e.element === 'none' ? '#ffffff' : EL_COLOR[e.element], 0.4, 5);
          this.sparks(e.x, e.y, e.element === 'none' ? '#ffffff' : EL_COLOR[e.element], 14, 340);
          this.trauma += 0.28 * intensity;
          sfx.explode();
          break;
        case 'chain':
          this.bolt(e.x1, e.y1, e.x2, e.y2);
          sfx.zap();
          break;
        case 'freeze':
          this.ring(e.x, e.y, CELL * 0.8, EL_COLOR.ice, 0.45, 3);
          this.sparks(e.x, e.y, EL_COLOR.ice, 10, 160);
          bump(e.id, 1, 1);
          sfx.freeze();
          break;
        case 'reflect':
          this.ring(e.x, e.y, 18, '#ffffff', 0.22, 2);
          bump(e.id, 0.9, 0.6);
          sfx.reflect();
          break;
        case 'armor':
          this.sparks(e.x, e.y, '#bfefff', 5, 180);
          bump(e.id, 0.5, 0.6);
          sfx.armor();
          break;
        case 'shieldBreak':
          this.ring(e.x, e.y, CELL * 0.75, '#9fe8ff', 0.35, 3);
          this.sparks(e.x, e.y, '#9fe8ff', 12, 260);
          sfx.shatter();
          break;
        case 'shieldUp':
          this.ring(e.x, e.y, CELL * 0.6, '#9fe8ff', 0.4, 2);
          break;
        case 'split':
          this.sparks(e.x, e.y, EL_COLOR[e.element], 6, 200);
          break;
        case 'heal':
          this.label(e.x, e.y - 6, `+${fmt(e.amount)}`, '#ff5c7a', 0.8);
          bump(e.id, 0.3, 0.5);
          sfx.heal();
          break;
        case 'pool':
          this.bubbles((e.col + 0.5) * CELL, FIELD_TOP + (e.row + 0.5) * CELL, 6);
          break;
        case 'poolHit':
          this.bubbles(e.x, e.y, 8);
          bump(e.id, 0.4, 0.4);
          break;
        case 'breach':
          this.shards(e.x, e.y, e.w, e.h, '#ff3b5c', 14);
          break;
        case 'vanish':
          this.shards(e.x, e.y, e.w, e.h, this.blockColor(e.kind, e.maxHp, floor), 8);
          break;
        case 'heroHit':
          this.redFlash = 1;
          this.trauma += 0.7;
          this.label(e.x, FIELD_BOTTOM + 14, `-${e.dmg}`, '#ff4d6d', 1.1);
          this.ring(e.x, FIELD_BOTTOM, 60, '#ff3b5c', 0.45, 5);
          sfx.heroHit();
          buzz(60);
          break;
        case 'ward':
          this.label(e.x, FIELD_BOTTOM + 14, 'WARDED', '#9fe8ff', 1.1);
          this.ring(e.x, FIELD_BOTTOM, 70, '#9fe8ff', 0.5, 5);
          sfx.armor();
          break;
        case 'heroHeal':
          this.label(W / 2, 74, `+${e.amount} HP`, '#6dff9c', 1.1);
          sfx.heal();
          break;
        case 'wall':
          sfx.wall();
          break;
        case 'launch':
          sfx.launch();
          break;
        case 'land':
          if (e.first) this.sparks(e.x, LAUNCH_Y, '#ffffff', 5, 120);
          break;
        case 'floorStart':
          if (e.boss) {
            this.showBanner('BOSS', `Floor ${e.floor}`, '#ff3b6b', 2);
            this.trauma += 0.8;
            sfx.boss();
          } else if (e.floor > 1) {
            this.showBanner(`FLOOR ${e.floor}`, '', '#5ee6ff', 1.1);
          }
          break;
        case 'floorClear':
          sfx.floorClear();
          for (let i = 0; i < 5; i++) this.sparks(W * (0.15 + 0.175 * i), FIELD_TOP + 200 + Math.random() * 120, ['#5ee6ff', '#ff4fd8', '#ffd45e'][i % 3], 12, 320);
          break;
        case 'bossPhase':
          this.showBanner('ENRAGED', 'Shield up, minions summoned', '#ff3b6b', 1.4);
          this.trauma += 0.6;
          this.whiteFlash = 0.4;
          sfx.boss();
          break;
        case 'bank':
          if (run.s.tower) this.showBanner('BOSS DOWN', 'The tower goes on', '#ffd45e', 1.8);
          else this.showBanner('LOOT BANKED', `${fmt(e.coins)} coins  +${e.gems} gems`, '#ffd45e', 1.8);
          break;
        case 'revive':
          this.whiteFlash = 0.9;
          this.ring(W / 2, LAUNCH_Y, 420, '#ffffff', 0.7, 8);
          sfx.floorClear();
          break;
        case 'dead':
          this.trauma = 1;
          this.redFlash = 1;
          sfx.death();
          buzz([80, 60, 160]);
          break;
        case 'perk':
          sfx.perk();
          break;
        case 'descend':
        case 'summon':
        case 'turnEnd':
          break;
      }
    }
    if (this.trauma > 1) this.trauma = 1;
  }

  // --------------------------------------------------------------- update

  update(dt: number): void {
    this.trauma = Math.max(0, this.trauma - dt * 1.9);
    this.hitStop = Math.max(0, this.hitStop - dt);
    this.redFlash = Math.max(0, this.redFlash - dt * 1.8);
    this.whiteFlash = Math.max(0, this.whiteFlash - dt * 2.2);
    this.comboPop = Math.max(0, this.comboPop - dt * 6);

    let w = 0;
    for (const p of this.parts) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      this.parts[w++] = p;
    }
    this.parts.length = w;

    w = 0;
    for (const n of this.nums) {
      n.age += dt;
      if (n.age >= n.max) continue;
      n.y -= dt * (n.text ? 26 : 34);
      this.nums[w++] = n;
    }
    this.nums.length = w;
    if (this.numByBlock.size > 200) this.numByBlock.clear();

    w = 0;
    for (const r of this.rings) {
      r.age += dt;
      if (r.age < r.max) this.rings[w++] = r;
    }
    this.rings.length = w;

    w = 0;
    for (const b of this.bolts) {
      b.age += dt;
      if (b.age < b.max) this.bolts[w++] = b;
    }
    this.bolts.length = w;

    if (this.banner) {
      this.banner.age += dt;
      if (this.banner.age >= this.banner.max) this.banner = null;
    }
  }

  shakeOffset(): [number, number] {
    const s = this.trauma * this.trauma * 9;
    return s > 0.05 ? [(Math.random() * 2 - 1) * s, (Math.random() * 2 - 1) * s] : [0, 0];
  }

  // ----------------------------------------------------------------- draw

  /** Glowing layer: drawn before the bloom pass. */
  drawGlow(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    for (const r of this.rings) {
      const t = r.age / r.max;
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width * (1 - t) + 0.5;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r * (0.25 + 0.75 * (1 - (1 - t) * (1 - t))), 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const b of this.bolts) {
      const a = 1 - b.age / b.max;
      for (let pass = 0; pass < 2; pass++) {
        ctx.globalAlpha = pass === 0 ? a * 0.5 : a;
        ctx.strokeStyle = pass === 0 ? EL_COLOR.lightning : '#ffffff';
        ctx.lineWidth = pass === 0 ? 5 : 1.6;
        ctx.beginPath();
        ctx.moveTo(b.pts[0], b.pts[1]);
        for (let i = 2; i < b.pts.length; i += 2) ctx.lineTo(b.pts[i], b.pts[i + 1]);
        ctx.stroke();
      }
    }

    for (const p of this.parts) {
      const a = Math.min(1, (p.life / p.max) * 1.6);
      ctx.globalAlpha = a;
      if (p.kind === 'spark') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
        ctx.stroke();
      } else if (p.kind === 'shard') {
        ctx.fillStyle = p.color;
        const c = Math.cos(p.rot);
        const s = Math.sin(p.rot);
        const z = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x + c * z, p.y + s * z);
        ctx.lineTo(p.x - s * z * 0.6, p.y + c * z * 0.6);
        ctx.lineTo(p.x - c * z * 0.7 + s * z * 0.3, p.y - s * z * 0.7 - c * z * 0.3);
        ctx.fill();
      } else {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1.4 - p.life / p.max), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** Crisp layer: drawn after the bloom pass so text stays readable. */
  drawNumbers(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const n of this.nums) {
      const t = n.age / n.max;
      const pop = n.age < 0.1 ? 1 + (1 - n.age / 0.1) * 0.6 : 1;
      const size = (n.text ? 13 : n.crit ? 19 : 13) * pop;
      ctx.globalAlpha = t > 0.65 ? 1 - (t - 0.65) / 0.35 : 1;
      ctx.font = `800 ${size.toFixed(1)}px ${FONT}`;
      const text = n.text ?? fmt(n.value) + (n.crit ? '!' : '');
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(5,5,15,0.85)';
      ctx.strokeText(text, n.x, n.y);
      ctx.fillStyle = n.color;
      ctx.fillText(text, n.x, n.y);
    }
    ctx.restore();
  }

  /** Full-screen overlays: damage vignette, flashes, banners. */
  drawOverlay(ctx: CanvasRenderingContext2D): void {
    if (this.redFlash > 0.01) {
      const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.7);
      g.addColorStop(0, 'rgba(255,40,80,0)');
      g.addColorStop(1, `rgba(255,40,80,${(this.redFlash * 0.55).toFixed(3)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    if (this.whiteFlash > 0.01) {
      ctx.fillStyle = `rgba(255,255,255,${(this.whiteFlash * 0.5).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
    const b = this.banner;
    if (b) {
      const t = b.age / b.max;
      const inT = Math.min(1, b.age / 0.18);
      const alpha = t > 0.75 ? 1 - (t - 0.75) / 0.25 : inT;
      const scale = 1 + (1 - inT) * 0.8;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(W / 2, 330);
      ctx.scale(scale, scale);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `900 46px ${FONT}`;
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 24;
      ctx.fillStyle = b.color;
      ctx.fillText(b.text, 0, 0);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = alpha * 0.9;
      ctx.fillText(b.text, 0, 0);
      if (b.sub) {
        ctx.globalAlpha = alpha;
        ctx.font = `700 15px ${FONT}`;
        ctx.fillStyle = '#e9ecff';
        ctx.fillText(b.sub, 0, 38);
      }
      ctx.restore();
    }
  }
}
