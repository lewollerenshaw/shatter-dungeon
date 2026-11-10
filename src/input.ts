import { H, LAUNCH_Y, MIN_AIM, W } from './sim/types';
import type { AimView } from './view/renderer';

export interface AimContext {
  canAim: boolean;
  launchX: number;
}

/**
 * Pointer aiming. Touch or click the field to aim straight at that point, or
 * start the drag below the launch line to pull back like a slingshot.
 */
export class AimInput implements AimView {
  active = false;
  valid = false;
  angle = Math.PI / 2;
  mode: 'direct' | 'pull' = 'direct';
  px = 0;
  py = 0;
  private sx = 0;
  private sy = 0;
  private pointerId = -1;

  constructor(
    private canvas: HTMLCanvasElement,
    private ctx: () => AimContext,
    private onFire: (angle: number) => void,
  ) {
    canvas.addEventListener('pointerdown', this.down);
    canvas.addEventListener('pointermove', this.move);
    canvas.addEventListener('pointerup', this.up);
    canvas.addEventListener('pointercancel', this.cancel);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private toLogical(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  }

  private down = (e: PointerEvent): void => {
    if (!this.ctx().canAim || this.active) return;
    e.preventDefault();
    const [x, y] = this.toLogical(e);
    this.active = true;
    this.pointerId = e.pointerId;
    this.sx = x;
    this.sy = y;
    this.mode = y > LAUNCH_Y - 6 ? 'pull' : 'direct';
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events have no capturable pointer.
    }
    this.aimAt(x, y);
  };

  private move = (e: PointerEvent): void => {
    if (!this.active || e.pointerId !== this.pointerId) return;
    const [x, y] = this.toLogical(e);
    this.aimAt(x, y);
  };

  private up = (e: PointerEvent): void => {
    if (!this.active || e.pointerId !== this.pointerId) return;
    const [x, y] = this.toLogical(e);
    this.aimAt(x, y);
    const fire = this.valid && this.ctx().canAim;
    this.active = false;
    this.valid = false;
    if (fire) this.onFire(this.angle);
  };

  private cancel = (): void => {
    this.active = false;
    this.valid = false;
  };

  private aimAt(x: number, y: number): void {
    this.px = x;
    this.py = y;
    const lx = this.ctx().launchX;
    let dx: number;
    let dy: number;
    if (this.mode === 'direct') {
      dx = x - lx;
      dy = y - LAUNCH_Y;
      this.valid = dy < -12;
    } else {
      dx = this.sx - x;
      dy = this.sy - y;
      this.valid = dy < -4 && Math.hypot(dx, dy) > 18;
    }
    if (!this.valid) return;
    const a = Math.atan2(-dy, dx);
    this.angle = Math.min(Math.PI - MIN_AIM, Math.max(MIN_AIM, a));
  }
}
