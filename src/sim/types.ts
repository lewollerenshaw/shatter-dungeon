// Logical playfield. The view scales this to the device.
export const W = 390;
export const H = 844;
export const COLS = 7;
export const ROWS = 10;
export const CELL = W / COLS;
export const FIELD_TOP = 96;
export const FIELD_BOTTOM = FIELD_TOP + ROWS * CELL;
export const LAUNCH_Y = 686;
export const BLOCK_PAD = 3;

export const BALL_RADIUS = 7;
export const BALL_SPEED = 840;
export const STEP = 1 / 120;
export const LAUNCH_INTERVAL = 0.065;
export const MIN_AIM = (10 * Math.PI) / 180;
export const MAX_BALLS = 160;
export const BASE_DMG = 3;
/** Sim-seconds after which a turn is force-recalled so it can never stall. */
export const TURN_LIMIT = 30;
export const BOSS_GEMS = 15;
export const REVIVE_GEM_COST = 50;

export type Element = 'none' | 'fire' | 'ice' | 'lightning' | 'poison';
export const ELEMENTS: Element[] = ['fire', 'ice', 'lightning', 'poison'];

export type Affix = 'reflective' | 'splitter' | 'vampiric' | 'frozen' | 'shielded';
export type BlockKind = 'normal' | 'elite' | 'mini' | 'minion' | 'boss';
export type Phase = 'perk' | 'aim' | 'firing' | 'resolve' | 'dead' | 'over';
export type PerkReason = 'starter' | 'floor' | 'boss';
export type DmgSrc = 'ball' | 'burn' | 'poison' | 'blast' | 'chain';

export interface Block {
  id: number;
  kind: BlockKind;
  col: number;
  row: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  /** Shield was damaged this turn (blocks regeneration). */
  shieldHit: boolean;
  affixes: Affix[];
  /** Ice armour hits remaining (Frozen affix). */
  armor: number;
  /** Reflective affix: next hit this turn is ignored. */
  reflectReady: boolean;
  burn: number;
  chill: number;
  /** 2 = frozen this turn (skips next descent), 1 = thawing, 0 = normal. */
  frozen: number;
  poison: number;
  coins: number;
  /** Boss has entered its shield phase. */
  phased: boolean;
  dead: boolean;
}

export interface Ball {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  element: Element;
  /** Split-shot ball: half damage, vanishes on landing. */
  temp: boolean;
  bounces: number;
  pierce: number;
  /** Block currently being pierced through (ignored for collision). */
  ghostId: number;
  recalled: boolean;
  speedMul: number;
  done: boolean;
}

export interface Pool {
  col: number;
  row: number;
  turns: number;
  stacks: number;
}

export interface RunStats {
  damage: number;
  kills: number;
  crits: number;
  turns: number;
  maxCombo: number;
  maxHit: number;
  bossKills: number;
}

export interface RunState {
  seed: number;
  rng: number;
  phase: Phase;
  floor: number;
  turn: number;
  blocks: Block[];
  nextId: number;
  pools: Pool[];
  rowsLeft: number;
  rowsTotal: number;
  balls: Ball[];
  /** The player's orb loadout. */
  orbs: Element[];
  /** Orbs for the turn in flight (after per-turn effects like Prism Core). */
  volley: Element[];
  toLaunch: number;
  launchTimer: number;
  launchAngle: number;
  launchX: number;
  nextLaunchX: number | null;
  hero: { hp: number; maxHp: number };
  perks: Record<string, number>;
  perkChoices: string[] | null;
  perkReason: PerkReason;
  combo: number;
  turnTime: number;
  resolveTimer: number;
  revived: boolean;
  stats: RunStats;
  /** coins = at risk until the next boss; banked = safe. Gems bank instantly. */
  loot: { coins: number; banked: number; gems: number };
}

export type SimEvent =
  | { t: 'launch'; x: number; y: number; element: Element }
  | { t: 'wall'; x: number; y: number }
  | { t: 'land'; x: number; first: boolean }
  | { t: 'hit'; id: number; x: number; y: number; dmg: number; crit: boolean; element: Element; src: DmgSrc }
  | {
      t: 'kill';
      id: number;
      x: number;
      y: number;
      w: number;
      h: number;
      kind: BlockKind;
      maxHp: number;
      coins: number;
    }
  | { t: 'explode'; x: number; y: number; r: number; element: Element }
  | { t: 'chain'; x1: number; y1: number; x2: number; y2: number }
  | { t: 'freeze'; id: number; x: number; y: number }
  | { t: 'reflect'; id: number; x: number; y: number }
  | { t: 'armor'; id: number; x: number; y: number }
  | { t: 'shieldBreak'; id: number; x: number; y: number }
  | { t: 'shieldUp'; id: number; x: number; y: number }
  | { t: 'split'; x: number; y: number; element: Element }
  | { t: 'heal'; id: number; x: number; y: number; amount: number }
  | { t: 'pool'; col: number; row: number }
  | { t: 'poolHit'; id: number; x: number; y: number }
  | { t: 'breach'; id: number; x: number; y: number; w: number; h: number; kind: BlockKind; maxHp: number }
  | { t: 'vanish'; id: number; x: number; y: number; w: number; h: number; kind: BlockKind; maxHp: number }
  | { t: 'heroHit'; dmg: number; x: number }
  | { t: 'heroHeal'; amount: number }
  | { t: 'descend' }
  | { t: 'summon' }
  | { t: 'turnEnd'; combo: number }
  | { t: 'floorStart'; floor: number; boss: boolean }
  | { t: 'floorClear'; floor: number; boss: boolean }
  | { t: 'bossPhase'; id: number }
  | { t: 'bank'; coins: number; gems: number }
  | { t: 'perk'; id: string }
  | { t: 'dead' }
  | { t: 'revive' };
