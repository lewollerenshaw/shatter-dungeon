import { clamp } from '../util';
import { endTurnAffixes, rollAffixes, splitBlock } from './affixes';
import { bossAct, bossPhase, spawnBoss } from './boss';
import { addChill, applyElementHit } from './elements';
import { NO_META, metaBonus, type MetaState } from './meta';
import { PERK_BY_ID, applyPerk, computeStats, rollPerks, type Stats } from './perks';
import { Grid, moveBall, traceAim, type Contact, type MoveHooks, type Point } from './physics';
import { pick, rand, randInt, randRange } from './rng';
import {
  blockHp,
  breachDamage,
  coinValue,
  eliteChance,
  fillChance,
  floorRows,
  isBossFloor,
} from './scaling';
import {
  BALL_SPEED,
  BASE_DMG,
  BOSS_GEMS,
  CELL,
  COLS,
  ELEMENTS,
  FIELD_TOP,
  LAUNCH_INTERVAL,
  LAUNCH_Y,
  MAX_BALLS,
  MIN_AIM,
  ROWS,
  STEP,
  TURN_LIMIT,
  W,
  type Affix,
  type Ball,
  type Block,
  type BlockKind,
  type DmgSrc,
  type Element,
  type RunState,
  type SimEvent,
} from './types';

export interface BlockInit {
  kind?: BlockKind;
  col: number;
  row: number;
  w?: number;
  h?: number;
  hp: number;
  affixes?: Affix[];
  coins?: number;
}

const RECALL_SPEED = 1900;
/** Block hits a split-shot orb gets before it fizzles. */
const TEMP_BOUNCES = 15;
/** Share of un-banked coins kept when a run ends before the next boss. */
export const UNBANKED_KEEP = 0.25;

function freshState(seed: number, meta: MetaState): RunState {
  const m = metaBonus(meta);
  const hp = 100 + m.maxHp;
  const orbs: Element[] = ['none', 'none', 'none'];
  for (let i = 0; i < m.extraOrbs; i++) orbs.push('none');
  return {
    seed,
    rng: seed | 0,
    phase: 'perk',
    floor: 0,
    turn: 0,
    blocks: [],
    nextId: 1,
    pools: [],
    rowsLeft: 0,
    rowsTotal: 0,
    balls: [],
    orbs,
    volley: [],
    toLaunch: 0,
    launchTimer: 0,
    launchAngle: Math.PI / 2,
    launchX: W / 2,
    nextLaunchX: null,
    hero: { hp, maxHp: hp },
    perks: {},
    perkChoices: null,
    perkReason: 'starter',
    combo: 0,
    turnTime: 0,
    resolveTimer: 0,
    revived: false,
    meta: { upgrades: { ...meta.upgrades }, talents: { ...meta.talents }, orbs: { ...meta.orbs } },
    rerolls: m.rerolls,
    wards: 0,
    stats: { damage: 0, kills: 0, crits: 0, turns: 0, maxCombo: 0, maxHit: 0, bossKills: 0 },
    loot: { coins: 0, banked: 0, gems: 0 },
  };
}

/**
 * One run of the dungeon. Pure simulation: no DOM, no wall-clock, all
 * randomness from the seeded state. `s` is plain data, so
 * `new Run(structuredClone(run.s))` gives an independent copy for lookahead.
 * A new run takes the player's permanent upgrades as `meta` and keeps a copy.
 * The view layer reads `s` and drains `events`.
 */
export class Run {
  s: RunState;
  stats: Stats;
  readonly grid = new Grid();
  events: SimEvent[] = [];
  /** Skip event recording (headless simulation). */
  silent = false;

  private acc = 0;
  private deaths: Block[] = [];
  private purge = false;
  private readonly hooks: MoveHooks;

  constructor(init: number | RunState, meta: MetaState = NO_META) {
    this.hooks = {
      hit: (ball, block, c) => this.hitBlock(ball, block, c),
      wall: (ball) => this.emit({ t: 'wall', x: ball.x, y: ball.y }),
    };
    if (typeof init === 'number') {
      this.s = freshState(init, meta);
      this.stats = computeStats(this.s.perks, this.s.meta);
      this.startFloor(1);
      this.s.phase = 'perk';
      this.s.perkReason = 'starter';
      this.s.perkChoices = rollPerks(this.s, 'starter', this.stats.perkChoices);
    } else {
      this.s = init;
      this.stats = computeStats(init.perks, init.meta);
      this.grid.rebuild(init.blocks);
    }
  }

  // ---------------------------------------------------------------- helpers

  emit(e: SimEvent): void {
    if (!this.silent) this.events.push(e);
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  center(b: Block): [number, number] {
    return [(b.col + b.w / 2) * CELL, FIELD_TOP + (b.row + b.h / 2) * CELL];
  }

  /** Living blocks within `reach` cells of `b` (diagonals included). */
  neighbours(b: Block, reach = 1): Block[] {
    const out: Block[] = [];
    for (const o of this.s.blocks) {
      if (o === b || o.dead) continue;
      if (
        o.col < b.col + b.w + reach &&
        o.col + o.w > b.col - reach &&
        o.row < b.row + b.h + reach &&
        o.row + o.h > b.row - reach
      ) {
        out.push(o);
      }
    }
    return out;
  }

  refreshStats(): void {
    this.stats = computeStats(this.s.perks, this.s.meta);
  }

  /** Path the first orb would take, for the aim preview. */
  traceAim(angle: number): Point[] {
    const a = clamp(angle, MIN_AIM, Math.PI - MIN_AIM);
    return traceAim(this.s.launchX, LAUNCH_Y - 1, a, this.stats.ballRadius, this.grid, 1, 110);
  }

  /** Coins and gems the player keeps if the run ended now. */
  payout(): { coins: number; gems: number; lost: number } {
    const kept = Math.floor(this.s.loot.coins * Math.min(1, UNBANKED_KEEP + this.stats.salvage));
    return { coins: this.s.loot.banked + kept, gems: this.s.loot.gems, lost: this.s.loot.coins - kept };
  }

  // ------------------------------------------------------------------ board

  addBlock(init: BlockInit): Block | null {
    const w = init.w ?? 1;
    const h = init.h ?? 1;
    if (!this.grid.isFree(init.col, init.row, w, h)) return null;
    const hp = Math.max(1, Math.round(init.hp));
    const affixes = init.affixes ?? [];
    const b: Block = {
      id: this.s.nextId++,
      kind: init.kind ?? 'normal',
      col: init.col,
      row: init.row,
      w,
      h,
      hp,
      maxHp: hp,
      shield: 0,
      maxShield: 0,
      shieldHit: false,
      affixes,
      armor: 0,
      reflectReady: affixes.includes('reflective'),
      burn: 0,
      chill: 0,
      frozen: 0,
      poison: 0,
      coins: init.coins ?? coinValue(this.s.floor),
      phased: false,
      dead: false,
    };
    if (affixes.includes('shielded')) b.maxShield = b.shield = Math.max(1, Math.round(hp * 0.5));
    if (affixes.includes('frozen')) b.armor = 3 + Math.floor(this.s.floor / 10);
    this.s.blocks.push(b);
    this.grid.place(b);
    return b;
  }

  /** A procedurally rolled block for the current floor. */
  spawnBlock(col: number, row: number, kind: 'normal' | 'minion' = 'normal'): Block | null {
    const s = this.s;
    if (!this.grid.isFree(col, row)) return null;
    let hp = blockHp(s.floor) * randRange(s, 0.7, 1.3);
    let coins = coinValue(s.floor);
    let k: BlockKind = kind;
    if (kind === 'minion') {
      hp *= 0.7;
    } else if (rand(s) < eliteChance(s.floor)) {
      k = 'elite';
      hp *= 2.4;
      coins *= 3;
    }
    return this.addBlock({ kind: k, col, row, hp, coins, affixes: rollAffixes(this, s.floor) });
  }

  spawnRow(row: number): void {
    const s = this.s;
    const p = fillChance(s.floor);
    const cols: number[] = [];
    for (let c = 0; c < COLS; c++) if (rand(s) < p) cols.push(c);
    while (cols.length < 2) {
      const c = randInt(s, COLS);
      if (!cols.includes(c)) cols.push(c);
    }
    // Always leave a gap so there is a way through.
    if (cols.length === COLS) cols.splice(randInt(s, COLS), 1);
    for (const c of cols) this.spawnBlock(c, row);
  }

  private removeBlock(b: Block): void {
    b.dead = true;
    this.grid.remove(b);
    const i = this.s.blocks.indexOf(b);
    if (i >= 0) this.s.blocks.splice(i, 1);
  }

  private addPool(col: number, row: number, stacks: number): void {
    const existing = this.s.pools.find((p) => p.col === col && p.row === row);
    if (existing) {
      existing.turns = 3;
      existing.stacks = Math.max(existing.stacks, stacks);
    } else {
      this.s.pools.push({ col, row, turns: 3, stacks });
    }
    this.emit({ t: 'pool', col, row });
  }

  startFloor(floor: number): void {
    const s = this.s;
    s.floor = floor;
    s.turn = 0;
    s.pools = [];
    s.blocks = [];
    s.balls = [];
    s.wards = this.stats.wards;
    this.grid.clear();
    if (isBossFloor(floor)) {
      s.rowsTotal = 0;
      s.rowsLeft = 0;
      spawnBoss(this);
    } else {
      const total = floorRows(floor);
      const first = Math.min(3, total);
      for (let i = 0; i < first; i++) this.spawnRow(first - 1 - i);
      s.rowsTotal = total;
      s.rowsLeft = total - first;
    }
    this.emit({ t: 'floorStart', floor, boss: isBossFloor(floor) });
  }

  private floorIsClear(): boolean {
    return this.s.blocks.length === 0 && this.s.rowsLeft === 0;
  }

  // ----------------------------------------------------------------- inputs

  /** Launch the volley. `angle` is radians anticlockwise from +x (π/2 = straight up). */
  fire(angle: number): boolean {
    const s = this.s;
    if (s.phase !== 'aim') return false;
    s.launchAngle = clamp(angle, MIN_AIM, Math.PI - MIN_AIM);
    s.volley = s.orbs.map((el) => (el === 'none' && this.stats.prism ? pick(s, ELEMENTS) : el));
    s.toLaunch = 0;
    s.launchTimer = 0;
    s.combo = 0;
    s.turnTime = 0;
    s.nextLaunchX = null;
    s.phase = 'firing';
    return true;
  }

  /** Call every orb home early. */
  recall(): void {
    const s = this.s;
    if (s.phase !== 'firing') return;
    s.toLaunch = s.volley.length;
    for (const b of s.balls) b.recalled = true;
  }

  choosePerk(index: number): boolean {
    const s = this.s;
    if (s.phase !== 'perk' || !s.perkChoices) return false;
    const id = s.perkChoices[index];
    if (!id || !PERK_BY_ID[id]) return false;
    s.perks[id] = (s.perks[id] ?? 0) + 1;
    applyPerk(s, id);
    const starter = s.perkReason === 'starter';
    if (starter) for (let i = 0; i < this.stats.starterCopies; i++) applyPerk(s, id);
    this.refreshStats();
    this.emit({ t: 'perk', id });
    s.perkChoices = null;
    if (!starter) this.startFloor(s.floor + 1);
    s.phase = 'resolve';
    s.resolveTimer = 0.35;
    return true;
  }

  /** Swap the offered perks for a fresh hand. Not available for the starter orb. */
  rerollPerks(): boolean {
    const s = this.s;
    if (s.phase !== 'perk' || !s.perkChoices || s.perkReason === 'starter' || s.rerolls <= 0) return false;
    s.rerolls--;
    s.perkChoices = rollPerks(s, s.perkReason, this.stats.perkChoices, s.perkChoices);
    return true;
  }

  /** Once per run: clear the board and stand back up at half health. */
  revive(): boolean {
    const s = this.s;
    if (s.phase !== 'dead' || s.revived) return false;
    s.revived = true;
    s.hero.hp = Math.ceil(s.hero.maxHp / 2);
    s.pools = [];
    const boss = s.blocks.find((b) => b.kind === 'boss');
    for (const b of s.blocks.slice()) {
      if (b === boss) continue;
      this.vanish(b);
    }
    if (boss) {
      this.grid.remove(boss);
      boss.row = 0;
      this.grid.place(boss);
    } else if (s.rowsLeft > 0) {
      const n = Math.min(2, s.rowsLeft);
      for (let i = 0; i < n; i++) this.spawnRow(n - 1 - i);
      s.rowsLeft -= n;
    }
    this.emit({ t: 'revive' });
    if (this.floorIsClear()) {
      this.floorCleared();
    } else {
      s.phase = 'resolve';
      s.resolveTimer = 0.5;
    }
    return true;
  }

  /** Give up after dying. */
  end(): void {
    if (this.s.phase === 'dead') this.s.phase = 'over';
  }

  // ------------------------------------------------------------- simulation

  update(dt: number): void {
    const p = this.s.phase;
    if (p !== 'firing' && p !== 'resolve') {
      this.acc = 0;
      return;
    }
    this.acc += dt;
    let guard = 0;
    while (this.acc >= STEP && guard++ < 96) {
      this.acc -= STEP;
      this.step();
    }
    if (guard >= 96) this.acc = 0;
  }

  private step(): void {
    const s = this.s;
    if (s.phase === 'firing') {
      this.stepFiring();
    } else if (s.phase === 'resolve') {
      s.resolveTimer -= STEP;
      if (s.resolveTimer <= 0) s.phase = 'aim';
    }
  }

  private stepFiring(): void {
    const s = this.s;
    s.turnTime += STEP;

    if (s.toLaunch < s.volley.length) {
      s.launchTimer -= STEP;
      while (s.launchTimer <= 0 && s.toLaunch < s.volley.length) {
        this.launch(s.volley[s.toLaunch++]);
        s.launchTimer += LAUNCH_INTERVAL;
      }
    }

    const balls = s.balls;
    const n = balls.length; // split-shot balls added this step move next step
    let anyDone = false;
    for (let i = 0; i < n; i++) {
      const ball = balls[i];
      if (ball.recalled) {
        ball.vx = 0;
        ball.vy = RECALL_SPEED;
        ball.y += RECALL_SPEED * STEP;
      } else {
        moveBall(ball, STEP, this.grid, this.hooks);
      }
      if (ball.y >= LAUNCH_Y && ball.vy > 0) {
        this.land(ball);
        anyDone = true;
      }
    }
    if (anyDone) s.balls = balls.filter((b) => !b.done);

    // Nothing left to hit, or the turn has run too long: bring everything home.
    if (s.blocks.length === 0 || s.turnTime > TURN_LIMIT) this.recall();

    if (s.toLaunch >= s.volley.length && s.balls.length === 0) this.endTurn();
  }

  private launch(element: Element): void {
    const s = this.s;
    const a = s.launchAngle;
    s.balls.push({
      id: s.nextId++,
      x: s.launchX,
      y: LAUNCH_Y - 1,
      vx: Math.cos(a) * BALL_SPEED,
      vy: -Math.sin(a) * BALL_SPEED,
      r: this.stats.ballRadius,
      element,
      temp: false,
      bounces: 0,
      pierce: this.stats.pierce,
      ghostId: 0,
      recalled: false,
      speedMul: 1,
      done: false,
    });
    this.emit({ t: 'launch', x: s.launchX, y: LAUNCH_Y, element });
  }

  private land(ball: Ball): void {
    const s = this.s;
    ball.done = true;
    const first = !ball.temp && !ball.recalled && s.nextLaunchX === null;
    if (first) s.nextLaunchX = clamp(ball.x, 14, W - 14);
    this.emit({ t: 'land', x: ball.x, first });
  }

  private splitFrom(ball: Ball): void {
    const s = this.s;
    const a = randRange(s, 0.25, Math.PI - 0.25);
    const dir = rand(s) < 0.5 ? -1 : 1;
    s.balls.push({
      id: s.nextId++,
      x: ball.x,
      y: ball.y,
      vx: Math.cos(a) * BALL_SPEED,
      vy: dir * Math.sin(a) * BALL_SPEED,
      r: ball.r * 0.8,
      element: ball.element,
      temp: true,
      bounces: 0,
      pierce: 0,
      ghostId: 0,
      recalled: false,
      speedMul: 1,
      done: false,
    });
    this.emit({ t: 'split', x: ball.x, y: ball.y, element: ball.element });
  }

  // ----------------------------------------------------------------- combat

  /** An orb touching a block. Returns false if the orb should pass through. */
  hitBlock(ball: Ball, block: Block, c: Contact): boolean {
    const s = this.s;
    const st = this.stats;
    if (block.dead) return true;
    const px = ball.x - c.nx * ball.r;
    const py = ball.y - c.ny * ball.r;
    ball.bounces++;
    s.combo++;
    if (s.combo > s.stats.maxCombo) s.stats.maxCombo = s.combo;

    if (block.reflectReady) {
      block.reflectReady = false;
      const next = Math.min(1.5, ball.speedMul * 1.2);
      const m = next / ball.speedMul;
      ball.speedMul = next;
      ball.vx *= m;
      ball.vy *= m;
      this.emit({ t: 'reflect', id: block.id, x: px, y: py });
      return true;
    }
    if (block.armor > 0) {
      block.armor = Math.max(0, block.armor - (ball.element === 'fire' ? 2 : 1));
      this.emit({ t: 'armor', id: block.id, x: px, y: py });
      return true;
    }

    let dmg = BASE_DMG * st.dmg * st.orbPower[ball.element] * (1 + st.comboDmg * Math.min(s.combo, 100));
    if (ball.temp) dmg *= 0.5;
    else if (ball.bounces <= st.openerHits) dmg *= 1 + st.openerBonus;
    if (ball.element !== 'none') dmg *= st.elementalDmg;
    const crit = rand(s) < st.critChance;
    if (crit) {
      dmg *= st.critMult;
      s.stats.crits++;
    }
    let pierce = false;
    if (ball.pierce > 0 && block.kind !== 'boss') {
      ball.pierce--;
      pierce = true;
    }

    this.damageBlock(block, dmg, ball.element, crit, 'ball', px, py);
    applyElementHit(this, ball.element, block, dmg);
    if (crit && st.critExplode > 0) this.blast(block, dmg * st.critExplode, 0, ball.element);
    if (st.chainEvery > 0 && ball.element !== 'lightning' && ball.bounces % st.chainEvery === 0) {
      this.chain(block, dmg * st.chainDmg, st.chainCount);
    }
    if (!ball.temp && st.splitChance > 0 && s.balls.length < MAX_BALLS && rand(s) < st.splitChance) {
      this.splitFrom(ball);
    }
    this.flushDeaths();
    // Out of charge: the orb burns out and flies home.
    if (ball.bounces >= (ball.temp ? TEMP_BOUNCES : st.maxBounces)) ball.recalled = true;
    return !pierce;
  }

  /** Apply damage through shields, record it, and queue the block if it dies. */
  damageBlock(
    b: Block,
    amount: number,
    element: Element,
    crit: boolean,
    src: DmgSrc,
    x: number,
    y: number,
  ): void {
    if (b.dead || amount <= 0) return;
    const s = this.s;
    const st = this.stats;
    if (b.frozen > 0) amount *= st.freezeBonus;
    if (st.reaction > 0) {
      const marks = (b.burn > 0 ? 1 : 0) + (b.poison > 0 ? 1 : 0) + (b.chill > 0 || b.frozen > 0 ? 1 : 0);
      if (marks >= 2) amount *= 1 + st.reaction;
    }
    const dealt = amount;
    if (b.shield > 0) {
      b.shieldHit = true;
      const absorbed = Math.min(b.shield, amount);
      b.shield -= absorbed;
      amount -= absorbed;
      if (b.shield <= 0) this.emit({ t: 'shieldBreak', id: b.id, x, y });
    }
    b.hp -= amount;
    s.stats.damage += dealt;
    if (dealt > s.stats.maxHit) s.stats.maxHit = dealt;
    this.emit({ t: 'hit', id: b.id, x, y, dmg: dealt, crit, element, src });

    if (b.kind === 'boss' && !b.phased && b.hp > 0 && b.hp <= b.maxHp * 0.5) bossPhase(this, b);
    if (st.execute > 0 && b.kind !== 'boss' && b.hp > 0 && b.shield <= 0 && b.hp < b.maxHp * st.execute) {
      b.hp = 0;
    }
    if (b.hp <= 0) {
      b.hp = 0;
      b.dead = true;
      this.deaths.push(b);
    }
  }

  /** Damage every neighbour of `source`. Used by fire deaths and crit explosions. */
  blast(source: Block, dmg: number, burn: number, element: Element): void {
    const [x, y] = this.center(source);
    this.emit({ t: 'explode', x, y, r: (Math.max(source.w, source.h) / 2 + 1) * CELL, element });
    for (const o of this.neighbours(source)) {
      const [ox, oy] = this.center(o);
      this.damageBlock(o, dmg, element, false, 'blast', ox, oy);
      if (burn > 0 && !o.dead) o.burn += burn;
    }
  }

  /** Lightning arcs from `source` to the nearest blocks. */
  chain(source: Block, dmg: number, count: number): void {
    const [sx, sy] = this.center(source);
    const reach = (2.6 * CELL) ** 2;
    const cands: { o: Block; d: number }[] = [];
    for (const o of this.s.blocks) {
      if (o === source || o.dead) continue;
      const [ox, oy] = this.center(o);
      const d = (ox - sx) ** 2 + (oy - sy) ** 2;
      if (d <= reach) cands.push({ o, d });
    }
    cands.sort((a, b) => a.d - b.d || a.o.id - b.o.id);
    for (let i = 0; i < Math.min(count, cands.length); i++) {
      const o = cands[i].o;
      const [ox, oy] = this.center(o);
      this.emit({ t: 'chain', x1: sx, y1: sy, x2: ox, y2: oy });
      this.damageBlock(o, dmg, 'lightning', false, 'chain', ox, oy);
    }
  }

  /** Resolve queued deaths, including the chain reactions they set off. */
  flushDeaths(): void {
    const s = this.s;
    const st = this.stats;
    while (this.deaths.length > 0) {
      const b = this.deaths.shift()!;
      this.removeBlock(b);
      s.stats.kills++;
      const coins = Math.round(b.coins * st.coinMult);
      s.loot.coins += coins;
      const [x, y] = this.center(b);
      this.emit({ t: 'kill', id: b.id, x, y, w: b.w, h: b.h, kind: b.kind, maxHp: b.maxHp, coins });

      if (b.kind === 'boss') {
        // The boss takes its minions with it.
        s.stats.bossKills++;
        this.purge = true;
        for (const o of s.blocks) {
          if (!o.dead) {
            o.dead = true;
            this.deaths.push(o);
          }
        }
        continue;
      }
      if (this.purge) continue;

      if (b.burn > 0) {
        this.blast(b, BASE_DMG * st.dmg * (1 + 0.5 * Math.min(b.burn, 20)) * st.burnPower, 1, 'fire');
      }
      if (st.fallout) this.fallout(b);
      if (b.affixes.includes('splitter')) splitBlock(this, b);
      if (b.poison > 0 || st.poolOnKill) this.addPool(b.col, b.row, st.poolStacks);
    }
    this.purge = false;
  }

  /** Fallout talent: a dying block passes a third of its burn and poison, and its chill, to its neighbours. */
  private fallout(b: Block): void {
    const burn = Math.ceil(b.burn / 3);
    const poison = Math.ceil(b.poison / 3);
    const cold = b.frozen > 0;
    if (burn === 0 && poison === 0 && !cold) return;
    for (const o of this.neighbours(b)) {
      o.burn += burn;
      o.poison += poison;
      if (cold) addChill(this, o, 1);
      if (poison > 0) {
        const [x, y] = this.center(o);
        this.emit({ t: 'poolHit', id: o.id, x, y });
      }
    }
  }

  // ------------------------------------------------------------ end of turn

  /** Everything that happens once the last orb is home. */
  endTurn(): void {
    const s = this.s;
    const st = this.stats;
    s.turn++;
    s.stats.turns++;
    s.balls = [];
    this.emit({ t: 'turnEnd', combo: s.combo });
    s.launchX = s.nextLaunchX ?? s.launchX;
    s.nextLaunchX = null;

    // Damage over time.
    for (const b of s.blocks.slice()) {
      if (b.dead) continue;
      const [x, y] = this.center(b);
      if (b.burn > 0) {
        this.damageBlock(b, BASE_DMG * st.dmg * 0.5 * b.burn * st.burnPower, 'fire', false, 'burn', x, y);
        if (!b.dead) b.burn = Math.floor(b.burn / 2);
      }
      if (!b.dead && b.poison > 0) {
        this.damageBlock(b, BASE_DMG * st.dmg * 0.35 * b.poison * st.poisonPower, 'poison', false, 'poison', x, y);
      }
    }
    this.flushDeaths();
    endTurnAffixes(this);

    if (this.floorIsClear()) {
      this.floorCleared();
      return;
    }

    const wasEmpty = s.blocks.length === 0;
    this.descend();
    if (s.rowsLeft > 0) {
      this.spawnRow(0);
      s.rowsLeft--;
      // The board was wiped: bring the next row in straight away too.
      if (wasEmpty && s.rowsLeft > 0) {
        this.descend();
        this.spawnRow(0);
        s.rowsLeft--;
      }
    }
    this.tickPools();
    const boss = s.blocks.find((b) => b.kind === 'boss');
    if (boss) bossAct(this, boss);

    s.combo = 0;
    if (s.hero.hp <= 0) {
      s.hero.hp = 0;
      s.phase = 'dead';
      this.emit({ t: 'dead' });
      return;
    }
    if (this.floorIsClear()) {
      this.floorCleared();
      return;
    }
    s.phase = 'resolve';
    s.resolveTimer = 0.4;
  }

  /** Move every block one row down, bottom rows first. */
  private descend(): void {
    const s = this.s;
    const order = s.blocks.slice().sort((a, b) => b.row + b.h - (a.row + a.h) || a.id - b.id);
    const bossMoves = s.turn % 2 === 0;
    for (const b of order) {
      if (b.dead) continue;
      if (b.frozen > 0) {
        const justFrozen = b.frozen === 2;
        b.frozen--;
        if (justFrozen && b.kind !== 'boss') continue;
      }
      if (b.kind === 'boss' && !bossMoves) continue;
      if (b.row + b.h >= ROWS) {
        this.breach(b);
        continue;
      }
      let free = true;
      for (let c = b.col; c < b.col + b.w; c++) if (this.grid.at(c, b.row + b.h)) free = false;
      if (!free) continue;
      this.grid.remove(b);
      b.row++;
      this.grid.place(b);
    }
    this.emit({ t: 'descend' });
  }

  /** A block reached the bottom line: it hits the hero and is spent. */
  private breach(b: Block): void {
    const s = this.s;
    const base = breachDamage(s.floor);
    const raw = b.kind === 'boss' ? base * 4 : b.kind === 'elite' ? base * 1.5 : base;
    const dmg = Math.max(1, Math.round(raw * this.stats.breachMult));
    const [x, y] = this.center(b);
    if (s.wards > 0) {
      s.wards--;
      this.emit({ t: 'ward', x });
    } else {
      s.hero.hp -= dmg;
      this.emit({ t: 'heroHit', dmg, x });
    }
    if (b.kind === 'boss') {
      // The boss slams, then recoils back up the board, crushing what is in its way.
      this.grid.remove(b);
      const row = Math.max(0, b.row - 4);
      for (const o of s.blocks.slice()) {
        if (o !== b && o.col < b.col + b.w && o.col + o.w > b.col && o.row < row + b.h && o.row + o.h > row) {
          this.vanish(o);
        }
      }
      b.row = row;
      this.grid.place(b);
    } else {
      this.removeBlock(b);
      this.emit({ t: 'breach', id: b.id, x, y, w: b.w, h: b.h, kind: b.kind, maxHp: b.maxHp });
    }
  }

  /** Remove a block with no loot and no death effects. */
  private vanish(b: Block): void {
    const [x, y] = this.center(b);
    this.removeBlock(b);
    this.emit({ t: 'vanish', id: b.id, x, y, w: b.w, h: b.h, kind: b.kind, maxHp: b.maxHp });
  }

  private tickPools(): void {
    const s = this.s;
    for (const p of s.pools) {
      const b = this.grid.at(p.col, p.row);
      if (b && !b.dead) {
        b.poison += p.stacks;
        const [x, y] = this.center(b);
        this.emit({ t: 'poolHit', id: b.id, x, y });
      }
      p.turns--;
    }
    s.pools = s.pools.filter((p) => p.turns > 0);
  }

  private floorCleared(): void {
    const s = this.s;
    const boss = isBossFloor(s.floor);
    this.emit({ t: 'floorClear', floor: s.floor, boss });
    if (this.stats.healOnFloor > 0 && s.hero.hp < s.hero.maxHp) {
      const amount = Math.min(this.stats.healOnFloor, s.hero.maxHp - s.hero.hp);
      s.hero.hp += amount;
      this.emit({ t: 'heroHeal', amount });
    }
    if (boss) {
      // Bosses are the checkpoint: everything collected so far is now safe.
      const coins = s.loot.coins;
      s.loot.banked += coins;
      s.loot.coins = 0;
      s.loot.gems += BOSS_GEMS;
      this.emit({ t: 'bank', coins, gems: BOSS_GEMS });
    }
    s.balls = [];
    s.pools = [];
    s.combo = 0;
    s.phase = 'perk';
    s.perkReason = boss ? 'boss' : 'floor';
    s.perkChoices = rollPerks(s, s.perkReason, this.stats.perkChoices);
  }
}
