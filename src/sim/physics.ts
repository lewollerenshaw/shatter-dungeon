import {
  BLOCK_PAD,
  CELL,
  COLS,
  FIELD_BOTTOM,
  FIELD_TOP,
  LAUNCH_Y,
  ROWS,
  W,
  type Ball,
  type Block,
} from './types';

export interface Contact {
  nx: number;
  ny: number;
  depth: number;
}

export interface MoveHooks {
  /** Return true to bounce off the block, false to pass through it. */
  hit(ball: Ball, block: Block, c: Contact): boolean;
  wall(ball: Ball): void;
}

/** Cell lookup for the board. Blocks may span several cells (the boss). */
export class Grid {
  readonly cells: (Block | null)[] = new Array<Block | null>(COLS * ROWS).fill(null);

  clear(): void {
    this.cells.fill(null);
  }

  at(col: number, row: number): Block | null {
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
    return this.cells[row * COLS + col];
  }

  isFree(col: number, row: number, w = 1, h = 1): boolean {
    if (col < 0 || row < 0 || col + w > COLS || row + h > ROWS) return false;
    for (let r = row; r < row + h; r++) {
      for (let c = col; c < col + w; c++) if (this.cells[r * COLS + c]) return false;
    }
    return true;
  }

  place(b: Block): void {
    for (let r = b.row; r < b.row + b.h; r++) {
      for (let c = b.col; c < b.col + b.w; c++) this.cells[r * COLS + c] = b;
    }
  }

  remove(b: Block): void {
    for (let r = b.row; r < b.row + b.h; r++) {
      for (let c = b.col; c < b.col + b.w; c++) {
        const i = r * COLS + c;
        if (this.cells[i] === b) this.cells[i] = null;
      }
    }
  }

  rebuild(blocks: Block[]): void {
    this.clear();
    for (const b of blocks) if (!b.dead) this.place(b);
  }
}

/** Circle vs axis-aligned rectangle. Fills `out` and returns true on overlap. */
export function circleRect(
  cx: number,
  cy: number,
  r: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  out: Contact,
): boolean {
  const px = cx < x0 ? x0 : cx > x1 ? x1 : cx;
  const py = cy < y0 ? y0 : cy > y1 ? y1 : cy;
  const dx = cx - px;
  const dy = cy - py;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return false;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    out.nx = dx / d;
    out.ny = dy / d;
    out.depth = r - d;
    return true;
  }
  // Centre is inside the rectangle: push out along the shallowest axis.
  const l = cx - x0;
  const rt = x1 - cx;
  const t = cy - y0;
  const b = y1 - cy;
  const m = Math.min(l, rt, t, b);
  if (m === t) {
    out.nx = 0;
    out.ny = -1;
    out.depth = t + r;
  } else if (m === b) {
    out.nx = 0;
    out.ny = 1;
    out.depth = b + r;
  } else if (m === l) {
    out.nx = -1;
    out.ny = 0;
    out.depth = l + r;
  } else {
    out.nx = 1;
    out.ny = 0;
    out.depth = rt + r;
  }
  return true;
}

/** Smallest share of a ball's speed that must be vertical. */
export const MIN_VERTICAL = 0.14;

/** Stops balls getting stuck bouncing sideways forever. Prefers heading down. */
export function fixAngle(ball: Ball): void {
  const sp = Math.hypot(ball.vx, ball.vy);
  if (sp === 0) return;
  const min = sp * MIN_VERTICAL;
  if (Math.abs(ball.vy) >= min) return;
  ball.vy = ball.vy < 0 ? -min : min;
  ball.vx = (ball.vx < 0 ? -1 : 1) * Math.sqrt(sp * sp - min * min);
}

const contact: Contact = { nx: 0, ny: 0, depth: 0 };
const seen: number[] = [0, 0, 0, 0];

/**
 * Advance one ball by `dt`, sub-stepping so it never moves more than a
 * fraction of its radius at once (no tunnelling). Stops early once the ball
 * has dropped back to the launch line.
 */
export function moveBall(ball: Ball, dt: number, grid: Grid, hooks: MoveHooks): void {
  const speed = Math.hypot(ball.vx, ball.vy);
  const n = Math.max(1, Math.ceil((speed * dt) / (ball.r * 0.8)));
  const sdt = dt / n;
  for (let i = 0; i < n; i++) {
    ball.x += ball.vx * sdt;
    ball.y += ball.vy * sdt;

    if (ball.x < ball.r) {
      ball.x = ball.r;
      if (ball.vx < 0) {
        ball.vx = -ball.vx;
        hooks.wall(ball);
      }
    } else if (ball.x > W - ball.r) {
      ball.x = W - ball.r;
      if (ball.vx > 0) {
        ball.vx = -ball.vx;
        hooks.wall(ball);
      }
    }
    if (ball.y < FIELD_TOP + ball.r) {
      ball.y = FIELD_TOP + ball.r;
      if (ball.vy < 0) {
        ball.vy = -ball.vy;
        hooks.wall(ball);
      }
    }

    if (ball.y - ball.r < FIELD_BOTTOM) {
      const c0 = Math.floor((ball.x - ball.r) / CELL);
      const c1 = Math.floor((ball.x + ball.r) / CELL);
      const r0 = Math.floor((ball.y - ball.r - FIELD_TOP) / CELL);
      const r1 = Math.floor((ball.y + ball.r - FIELD_TOP) / CELL);
      let nSeen = 0;
      let ghostStill = false;
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const b = grid.at(c, r);
          if (!b) continue;
          let dup = false;
          for (let k = 0; k < nSeen; k++) if (seen[k] === b.id) dup = true;
          if (dup) continue;
          if (nSeen < 4) seen[nSeen++] = b.id;
          const x0 = b.col * CELL + BLOCK_PAD;
          const y0 = FIELD_TOP + b.row * CELL + BLOCK_PAD;
          const x1 = (b.col + b.w) * CELL - BLOCK_PAD;
          const y1 = FIELD_TOP + (b.row + b.h) * CELL - BLOCK_PAD;
          if (!circleRect(ball.x, ball.y, ball.r, x0, y0, x1, y1, contact)) continue;
          if (b.id === ball.ghostId) {
            ghostStill = true;
            continue;
          }
          const nx = contact.nx;
          const ny = contact.ny;
          const depth = contact.depth;
          if (!hooks.hit(ball, b, contact)) {
            ball.ghostId = b.id;
            ghostStill = true;
            continue;
          }
          ball.x += nx * depth;
          ball.y += ny * depth;
          const vn = ball.vx * nx + ball.vy * ny;
          if (vn < 0) {
            ball.vx -= 2 * vn * nx;
            ball.vy -= 2 * vn * ny;
          }
          fixAngle(ball);
        }
      }
      if (!ghostStill) ball.ghostId = 0;
    }

    if (ball.y >= LAUNCH_Y && ball.vy > 0) return;
  }
}

export interface Point {
  x: number;
  y: number;
}

/** Ghost-ball path for the aim preview: start, each bounce, then a short tail. */
export function traceAim(
  x: number,
  y: number,
  angle: number,
  r: number,
  grid: Grid,
  maxBounces = 2,
  tail = 70,
): Point[] {
  const speed = 600;
  const ball: Ball = {
    id: -1,
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: -Math.sin(angle) * speed,
    r,
    element: 'none',
    temp: true,
    bounces: 0,
    pierce: 0,
    ghostId: 0,
    recalled: false,
    speedMul: 1,
    done: false,
  };
  const pts: Point[] = [{ x, y }];
  let bounces = 0;
  const mark = () => {
    bounces++;
    pts.push({ x: ball.x, y: ball.y });
  };
  const hooks: MoveHooks = {
    hit: () => {
      mark();
      return true;
    },
    wall: mark,
  };
  let after = 0;
  for (let i = 0; i < 600; i++) {
    moveBall(ball, 1 / 120, grid, hooks);
    if (bounces >= maxBounces) {
      after += speed / 120;
      if (after >= tail) break;
    }
    if (ball.y >= LAUNCH_Y && ball.vy > 0) break;
  }
  pts.push({ x: ball.x, y: ball.y });
  return pts;
}
