import type { Run } from '../sim/run';
import { blockHp } from '../sim/scaling';
import {
  BLOCK_PAD,
  CELL,
  COLS,
  FIELD_BOTTOM,
  FIELD_TOP,
  H,
  LAUNCH_Y,
  ROWS,
  W,
  type Block,
} from '../sim/types';
import { fmt } from '../util';
import type { Fx } from './fx';
import { drawHud } from './hud';
import { EL_COLOR, FONT, blockHue } from './palette';

export interface AimView {
  active: boolean;
  valid: boolean;
  angle: number;
  mode: 'direct' | 'pull';
  px: number;
  py: number;
}

/** Smoothed on-screen state for a block (the sim only knows grid cells). */
interface BlockView {
  x: number;
  y: number;
  flash: number;
  pop: number;
  alpha: number;
  frame: number;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  /** Device pixels per logical unit. */
  private k = 1;
  private bg = document.createElement('canvas');
  private bloomA = document.createElement('canvas');
  private bloomB = document.createElement('canvas');
  private views = new Map<number, BlockView>();
  private glows = new Map<string, HTMLCanvasElement>();
  private frame = 0;
  private time = 0;
  bloom = true;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }

  resize(cssScale: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.k = Math.max(1, Math.min(3, cssScale * dpr));
    const c = this.canvas;
    c.width = Math.round(W * this.k);
    c.height = Math.round(H * this.k);
    this.bloomA.width = Math.ceil(c.width / 4);
    this.bloomA.height = Math.ceil(c.height / 4);
    this.bloomB.width = Math.ceil(c.width / 10);
    this.bloomB.height = Math.ceil(c.height / 10);
    this.paintBackground();
  }

  reset(): void {
    this.views.clear();
  }

  /** Flash and squash a block that was just hit. */
  bump = (id: number, flash: number, pop: number): void => {
    const v = this.views.get(id);
    if (!v) return;
    if (flash > v.flash) v.flash = flash;
    if (pop > v.pop) v.pop = pop;
  };

  private paintBackground(): void {
    const c = this.bg;
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const g = c.getContext('2d')!;
    g.setTransform(this.k, 0, 0, this.k, 0, 0);
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#0b0a1f');
    grad.addColorStop(0.55, '#07071a');
    grad.addColorStop(1, '#05050f');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    // Faint cell grid inside the play field.
    g.strokeStyle = 'rgba(120,140,255,0.055)';
    g.lineWidth = 1;
    g.beginPath();
    for (let c2 = 1; c2 < COLS; c2++) {
      g.moveTo(c2 * CELL, FIELD_TOP);
      g.lineTo(c2 * CELL, FIELD_BOTTOM);
    }
    for (let r = 1; r < ROWS; r++) {
      g.moveTo(0, FIELD_TOP + r * CELL);
      g.lineTo(W, FIELD_TOP + r * CELL);
    }
    g.stroke();

    // Ceiling and floor rails.
    g.fillStyle = 'rgba(94,230,255,0.35)';
    g.fillRect(0, FIELD_TOP - 2, W, 2);
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.fillRect(0, LAUNCH_Y + 9, W, 1.5);

    const vig = g.createRadialGradient(W / 2, H * 0.45, H * 0.2, W / 2, H * 0.45, H * 0.75);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = vig;
    g.fillRect(0, 0, W, H);
  }

  private glowSprite(color: string): HTMLCanvasElement {
    let c = this.glows.get(color);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.2, color);
    grad.addColorStop(0.5, color + '50');
    grad.addColorStop(1, color + '00');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this.glows.set(color, c);
    return c;
  }

  // ------------------------------------------------------------------ frame

  draw(run: Run | null, fx: Fx, aim: AimView | null, dt: number): void {
    const ctx = this.ctx;
    const k = this.k;
    this.time += dt;
    this.frame++;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.bg, 0, 0);

    const [sx, sy] = fx.shakeOffset();
    ctx.setTransform(k, 0, 0, k, sx * k, sy * k);

    if (run) {
      this.syncViews(run, dt);
      this.drawPools(run);
      this.drawDangerLine(run);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, FIELD_TOP, W, H - FIELD_TOP);
      ctx.clip();
      const base = blockHp(run.s.floor);
      for (const b of run.s.blocks) {
        const v = this.views.get(b.id);
        if (v) this.drawBlock(b, v, base, run.stats.freezeAt);
      }
      ctx.restore();
      if (aim && aim.active && run.s.phase === 'aim') this.drawAim(run, aim);
      this.drawBalls(run);
      this.drawLauncher(run);
    } else {
      this.drawAmbient();
    }
    fx.drawGlow(ctx);

    if (this.bloom) this.bloomPass();

    ctx.setTransform(k, 0, 0, k, sx * k, sy * k);
    fx.drawNumbers(ctx);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    if (run) drawHud(ctx, run, fx, this.time);
    fx.drawOverlay(ctx);
  }

  /** Cheap bloom: shrink the frame twice and add the blurry copies back. */
  private bloomPass(): void {
    const ctx = this.ctx;
    const a = this.bloomA;
    const b = this.bloomB;
    const ac = a.getContext('2d')!;
    const bc = b.getContext('2d')!;
    ac.globalCompositeOperation = 'copy';
    ac.drawImage(this.canvas, 0, 0, a.width, a.height);
    bc.globalCompositeOperation = 'copy';
    bc.drawImage(a, 0, 0, b.width, b.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalAlpha = 0.38;
    ctx.drawImage(a, 0, 0, this.canvas.width, this.canvas.height);
    ctx.globalAlpha = 0.5;
    ctx.drawImage(b, 0, 0, this.canvas.width, this.canvas.height);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  private syncViews(run: Run, dt: number): void {
    const frame = this.frame;
    const ease = 1 - Math.exp(-dt * 14);
    for (const b of run.s.blocks) {
      const tx = b.col * CELL;
      const ty = FIELD_TOP + b.row * CELL;
      let v = this.views.get(b.id);
      if (!v) {
        const born = b.kind === 'mini' || b.kind === 'minion';
        v = { x: tx, y: born ? ty : ty - CELL, flash: born ? 0.8 : 0, pop: born ? 1 : 0, alpha: 0, frame };
        this.views.set(b.id, v);
      }
      v.x += (tx - v.x) * ease;
      v.y += (ty - v.y) * ease;
      v.alpha = Math.min(1, v.alpha + dt * 6);
      v.flash = Math.max(0, v.flash - dt * 6);
      v.pop = Math.max(0, v.pop - dt * 7);
      v.frame = frame;
    }
    for (const [id, v] of this.views) if (v.frame !== frame) this.views.delete(id);
  }

  // ----------------------------------------------------------------- pieces

  private drawAmbient(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const colors = ['#5ee6ff', '#ff4fd8', '#ffd45e', '#7dff5a'];
    for (let i = 0; i < 26; i++) {
      const sp = 12 + (i % 5) * 7;
      const x = (i * 97.3 + Math.sin(this.time * 0.3 + i) * 30 + W) % W;
      const y = H - ((this.time * sp + i * 131) % (H + 40));
      const s = 10 + (i % 4) * 6;
      ctx.globalAlpha = 0.25 + 0.2 * Math.sin(this.time + i);
      ctx.drawImage(this.glowSprite(colors[i % 4]), x - s, y - s, s * 2, s * 2);
    }
    ctx.restore();
  }

  private drawPools(run: Run): void {
    const ctx = this.ctx;
    for (const p of run.s.pools) {
      const x = (p.col + 0.5) * CELL;
      const y = FIELD_TOP + (p.row + 0.5) * CELL;
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 4 + p.col);
      // Fades as the pool runs out of turns.
      const life = Math.min(1, p.turns / 3);
      ctx.globalAlpha = (0.07 + 0.05 * pulse) * (0.5 + 0.5 * life);
      ctx.fillStyle = EL_COLOR.poison;
      ctx.beginPath();
      ctx.ellipse(x, y, CELL * 0.36, CELL * 0.26, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.3 * (0.5 + 0.5 * life);
      ctx.strokeStyle = EL_COLOR.poison;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }

  private drawDangerLine(run: Run): void {
    const ctx = this.ctx;
    let threat = 0;
    for (const b of run.s.blocks) {
      const bottom = b.row + b.h;
      if (bottom >= ROWS) threat = 1;
      else if (bottom === ROWS - 1 && threat < 0.5) threat = 0.5;
    }
    const pulse = threat > 0 ? 0.5 + 0.5 * Math.sin(this.time * (threat === 1 ? 12 : 6)) : 0;
    ctx.save();
    ctx.strokeStyle = '#ff3b5c';
    ctx.globalAlpha = 0.22 + threat * 0.5 * pulse;
    ctx.lineWidth = 1.5 + threat * 1.5;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.moveTo(0, FIELD_BOTTOM + 3);
    ctx.lineTo(W, FIELD_BOTTOM + 3);
    ctx.stroke();
    ctx.restore();
  }

  private drawBlock(b: Block, v: BlockView, floorBase: number, freezeAt: number): void {
    const ctx = this.ctx;
    const w = b.w * CELL - BLOCK_PAD * 2;
    const h = b.h * CELL - BLOCK_PAD * 2;
    const cx = v.x + (b.w * CELL) / 2;
    const cy = v.y + (b.h * CELL) / 2;
    const boss = b.kind === 'boss';
    const hue = blockHue(b.kind, b.hp, floorBase);
    const scale = 1 - v.pop * 0.07;
    const radius = boss ? 16 : 9;
    const frac = Math.max(0, Math.min(1, b.hp / b.maxHp));
    const frozen = b.frozen > 0;
    const edge = `hsl(${hue} 95% 62%)`;

    ctx.save();
    ctx.globalAlpha = v.alpha;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    const x = -w / 2;
    const y = -h / 2;

    // Body, with a "liquid" level showing remaining health.
    roundRect(ctx, x, y, w, h, radius);
    ctx.fillStyle = `hsl(${hue} 60% 9%)`;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = `hsl(${hue} 78% 26%)`;
    ctx.fillRect(x, y + h * (1 - frac), w, h * frac);
    if (frozen) {
      ctx.fillStyle = 'rgba(150,235,255,0.42)';
      ctx.fillRect(x, y, w, h);
    } else if (b.armor > 0) {
      ctx.fillStyle = 'rgba(150,225,255,0.22)';
      ctx.fillRect(x, y, w, h);
    }
    if (v.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${(v.flash * 0.4).toFixed(3)})`;
      ctx.fillRect(x, y, w, h);
    }
    ctx.restore();

    // Outline. Burning blocks flicker orange.
    roundRect(ctx, x, y, w, h, radius);
    ctx.lineWidth = boss ? 3 : b.kind === 'elite' ? 2.6 : 2;
    if (b.kind === 'mini') ctx.setLineDash([5, 3]);
    ctx.strokeStyle = frozen ? '#bff3ff' : edge;
    ctx.stroke();
    ctx.setLineDash([]);
    if (b.burn > 0) {
      ctx.globalAlpha = v.alpha * (0.45 + 0.35 * Math.sin(this.time * 18 + b.id));
      ctx.strokeStyle = EL_COLOR.fire;
      ctx.lineWidth = 3;
      roundRect(ctx, x - 1.5, y - 1.5, w + 3, h + 3, radius + 1.5);
      ctx.stroke();
      ctx.globalAlpha = v.alpha;
    }

    this.drawAffixes(b, x, y, w, h, radius);

    // Face: a pair of eyes that squint when struck.
    const eyeY = y + h * (boss ? 0.3 : 0.3);
    const eyeDx = w * (boss ? 0.2 : 0.19);
    const ew = boss ? 16 : 5.5;
    const eh = (boss ? 18 : 6.5) * (v.flash > 0.25 ? 0.3 : 1);
    ctx.fillStyle = b.affixes.includes('vampiric') ? '#ff4d6d' : `hsl(${hue} 100% 82%)`;
    for (const dir of [-1, 1]) {
      roundRect(ctx, dir * eyeDx - ew / 2, eyeY - eh / 2, ew, eh, Math.min(ew, eh) / 2);
      ctx.fill();
    }
    if (boss || b.kind === 'elite') {
      // Angry brows.
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = boss ? 4 : 1.6;
      ctx.lineCap = 'round';
      const bw = boss ? 16 : 5;
      const by = eyeY - (boss ? 18 : 6.5);
      ctx.beginPath();
      ctx.moveTo(-eyeDx - bw, by - bw * 0.35);
      ctx.lineTo(-eyeDx + bw * 0.7, by + bw * 0.35);
      ctx.moveTo(eyeDx + bw, by - bw * 0.35);
      ctx.lineTo(eyeDx - bw * 0.7, by + bw * 0.35);
      ctx.stroke();
    }
    if (b.affixes.includes('vampiric')) {
      ctx.fillStyle = '#ffffff';
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(dir * 3 - 2, eyeY + 6);
        ctx.lineTo(dir * 3 + 2, eyeY + 6);
        ctx.lineTo(dir * 3, eyeY + 11);
        ctx.fill();
      }
    }

    // Health number.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${boss ? 30 : 14}px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(fmt(Math.ceil(b.hp)), 0, y + h * (boss ? 0.62 : 0.68));

    this.drawStatus(b, x, y, w, h, freezeAt);
    ctx.restore();
  }

  private drawAffixes(b: Block, x: number, y: number, w: number, h: number, radius: number): void {
    const ctx = this.ctx;
    if (b.affixes.includes('reflective')) {
      ctx.save();
      ctx.globalAlpha *= b.reflectReady ? 0.95 : 0.22;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      roundRect(ctx, x + 3.5, y + 3.5, w - 7, h - 7, Math.max(2, radius - 3));
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + 7, y + 15);
      ctx.lineTo(x + 15, y + 7);
      ctx.stroke();
      ctx.restore();
    }
    if (b.affixes.includes('splitter')) {
      ctx.save();
      ctx.globalAlpha *= 0.7;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, y + 2);
      ctx.lineTo(0, y + h - 2);
      ctx.stroke();
      ctx.restore();
    }
    if (b.armor > 0) {
      ctx.fillStyle = '#d9f6ff';
      const n = Math.min(b.armor, 6);
      for (let i = 0; i < n; i++) {
        ctx.beginPath();
        ctx.arc((i - (n - 1) / 2) * 7, y + 7, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (b.shield > 0 && b.maxShield > 0) {
      ctx.save();
      ctx.strokeStyle = '#9fe8ff';
      ctx.lineWidth = 2.5;
      ctx.globalAlpha *= 0.55 + 0.25 * Math.sin(this.time * 5 + b.id);
      roundRect(ctx, x - 2.5, y - 2.5, w + 5, h + 5, radius + 2.5);
      ctx.stroke();
      ctx.restore();
      // Shield meter along the bottom edge.
      const sw = (w - 12) * Math.min(1, b.shield / b.maxShield);
      ctx.fillStyle = 'rgba(159,232,255,0.25)';
      ctx.fillRect(x + 6, y + h - 6.5, w - 12, 3);
      ctx.fillStyle = '#9fe8ff';
      ctx.fillRect(x + 6, y + h - 6.5, sw, 3);
    }
  }

  private drawStatus(b: Block, x: number, y: number, w: number, h: number, freezeAt: number): void {
    const ctx = this.ctx;
    const badge = (bx: number, by: number, color: string, n: number): void => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(bx, by, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#05050f';
      ctx.font = `800 8.5px ${FONT}`;
      ctx.fillText(n > 99 ? '99' : String(n), bx, by + 0.5);
    };
    if (b.burn > 0) badge(x + 4, y + h - 4, EL_COLOR.fire, b.burn);
    if (b.poison > 0) badge(x + w - 4, y + h - 4, EL_COLOR.poison, b.poison);
    if (b.frozen > 0) {
      // Frost cracks.
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 5, y + 6);
      ctx.lineTo(x + w * 0.4, y + h * 0.35);
      ctx.lineTo(x + w * 0.3, y + h * 0.6);
      ctx.moveTo(x + w - 5, y + h - 8);
      ctx.lineTo(x + w * 0.65, y + h * 0.55);
      ctx.stroke();
    } else if (b.chill > 0) {
      for (let i = 0; i < freezeAt; i++) {
        ctx.fillStyle = i < b.chill ? EL_COLOR.ice : 'rgba(111,227,255,0.22)';
        ctx.fillRect(x + 5 + i * 5.5, y + 5, 4, 4);
      }
    }
  }

  private drawAim(run: Run, aim: AimView): void {
    const ctx = this.ctx;
    const s = run.s;
    if (aim.mode === 'pull') {
      // Slingshot band back to the finger.
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.launchX, LAUNCH_Y);
      ctx.lineTo(aim.px, aim.py);
      ctx.stroke();
      ctx.restore();
    }
    if (!aim.valid) return;
    const pts = run.traceAim(aim.angle);
    const gap = 13;
    let offset = (this.time * 60) % gap;
    let drawn = 0;
    ctx.save();
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 0.001) continue;
      for (let d = offset; d < len; d += gap) {
        ctx.globalAlpha = Math.max(0.12, 0.85 - drawn * 0.018) * (i === 0 ? 1 : 0.6);
        ctx.beginPath();
        ctx.arc(a.x + ((b.x - a.x) * d) / len, a.y + ((b.y - a.y) * d) / len, i === 0 ? 2.4 : 1.8, 0, Math.PI * 2);
        ctx.fill();
        drawn++;
      }
      offset = (offset + gap - (len % gap)) % gap;
    }
    // Ghost orb at the first bounce.
    if (pts.length > 2) {
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pts[1].x, pts[1].y, run.stats.ballRadius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawBalls(run: Run): void {
    const ctx = this.ctx;
    const balls = run.s.balls;
    if (balls.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const ball of balls) {
      const color = EL_COLOR[ball.element];
      const sp = Math.hypot(ball.vx, ball.vy) || 1;
      const tail = ball.recalled ? 34 : 20;
      ctx.globalAlpha = ball.temp ? 0.25 : 0.4;
      ctx.strokeStyle = color;
      ctx.lineWidth = ball.r * 1.3;
      ctx.beginPath();
      ctx.moveTo(ball.x, ball.y);
      ctx.lineTo(ball.x - (ball.vx / sp) * tail, ball.y - (ball.vy / sp) * tail);
      ctx.stroke();
      ctx.globalAlpha = ball.recalled ? 0.5 : 1;
      const g = ball.r * 3.2;
      ctx.drawImage(this.glowSprite(color), ball.x - g, ball.y - g, g * 2, g * 2);
    }
    ctx.restore();
    ctx.fillStyle = '#ffffff';
    for (const ball of balls) {
      if (ball.recalled) continue;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r * 0.72, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawLauncher(run: Run): void {
    const ctx = this.ctx;
    const s = run.s;
    const waiting = s.phase === 'firing' ? s.volley.length - s.toLaunch : s.orbs.length;
    const r = run.stats.ballRadius;
    ctx.save();
    if (waiting > 0 || s.phase !== 'firing') {
      const pulse = s.phase === 'aim' ? 1 + 0.12 * Math.sin(this.time * 5) : 1;
      const g = r * 3.4 * pulse;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this.glowSprite('#dfe8ff'), s.launchX - g, LAUNCH_Y - g, g * 2, g * 2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(s.launchX, LAUNCH_Y, r * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    // Where the next volley will start from.
    if (s.phase === 'firing' && s.nextLaunchX !== null) {
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(s.nextLaunchX, LAUNCH_Y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}
