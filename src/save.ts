import { ENERGY_MAX, newEnergy, type EnergyState } from './sim/energy';
import { sanitizeMeta } from './sim/meta';
import { CHEST_IDS, sanitizeInventory, type ChestId } from './sim/orbs';
import { sanitizePass } from './sim/pass';
import { isRunInput } from './sim/replay';
import { STARTER_GEMS, newWallet, type Wallet } from './sim/store';
import { cleanName, towerWeek, type TowerScore } from './sim/tower';
import type { RunInput } from './sim/types';

/** The player's side of the Weekly Tower. */
export interface TowerSave {
  /** Random id that stands for this player on the leaderboard. Never shown to others. */
  playerId: string;
  name: string;
  /** The week `best` and `pending` belong to. */
  week: number;
  best: TowerScore | null;
  /** A best run the server has not confirmed yet. */
  pending: { week: number; log: RunInput[] } | null;
}

/** Player preferences. They survive a progress reset. */
export interface Settings {
  muted: boolean;
  /** Chosen game speed: 1, 2 or 4. */
  speed: number;
  shake: boolean;
  /** Phone vibration on hits and deaths, where the device supports it. */
  haptics: boolean;
  /** The bloom glow. The game may still drop it on a device that cannot keep up. */
  glow: boolean;
  /** Developer mode: runs use a fully upgraded hero. Only honoured in development builds. */
  dev: boolean;
}

export const SPEEDS = [1, 2, 4];

export const defaultSettings = (): Settings => ({ muted: false, speed: 1, shake: true, haptics: true, glow: true, dev: false });

/** Persistent profile, kept in localStorage. */
export interface SaveData extends Wallet {
  v: 4;
  bestFloor: number;
  runs: number;
  settings: Settings;
  tower: TowerSave;
}

/** The key keeps its original name so saves from earlier versions still load. */
export const SAVE_KEY = 'shatter-dungeon-save-v1';
const KEY = SAVE_KEY;

let mirror: ((key: string, json: string) => void) | null = null;

/** Have every write also go somewhere sturdier than localStorage (the native app sets this). */
export function setSaveMirror(fn: (key: string, json: string) => void): void {
  mirror = fn;
}

function newPlayerId(): string {
  // randomUUID needs a secure context, which a phone on the local network does not have.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  let id = '';
  for (let i = 0; i < 32; i++) id += Math.floor(Math.random() * 16).toString(16);
  return id;
}

function newTower(now: number): TowerSave {
  return {
    playerId: newPlayerId(),
    name: `Climber ${1000 + Math.floor(Math.random() * 9000)}`,
    week: towerWeek(now),
    best: null,
    pending: null,
  };
}

function defaults(now: number): SaveData {
  const seed = (now ^ (Math.random() * 0x7fffffff)) | 0;
  return { v: 4, bestFloor: 0, runs: 0, settings: defaultSettings(), tower: newTower(now), ...newWallet(now, seed) };
}

function readSettings(raw: unknown): Settings {
  const d = defaultSettings();
  const s = raw as Partial<Settings> | null;
  if (!s || typeof s !== 'object') return d;
  const speed = Number(s.speed);
  // Settings added later default to on, so only an explicit false turns them off.
  return {
    muted: s.muted === true,
    speed: SPEEDS.includes(speed) ? speed : d.speed,
    shake: s.shake !== false,
    haptics: s.haptics !== false,
    glow: s.glow !== false,
    dev: s.dev === true,
  };
}

function readTower(raw: unknown, now: number): TowerSave {
  const fresh = newTower(now);
  const t = raw as Partial<TowerSave> | null;
  if (!t || typeof t !== 'object') return fresh;
  const playerId = typeof t.playerId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(t.playerId) ? t.playerId : fresh.playerId;
  const name = cleanName(t.name) ?? fresh.name;
  // Scores from an earlier week no longer count.
  if (t.week !== fresh.week) return { ...fresh, playerId, name };
  const best = t.best && Number.isFinite(Number(t.best.floor)) ? { floor: count(t.best.floor), kills: count(t.best.kills) } : null;
  const p = t.pending;
  const pending =
    p && p.week === fresh.week && Array.isArray(p.log) && p.log.every(isRunInput) ? { week: fresh.week, log: p.log } : null;
  return { playerId, name, week: fresh.week, best, pending };
}

const count = (n: unknown): number => Math.max(0, Math.floor(Number(n)) || 0);

function readEnergy(raw: unknown, now: number): EnergyState {
  const e = raw as Partial<EnergyState> | null;
  if (!e || typeof e !== 'object' || !Number.isFinite(Number(e.n))) return newEnergy(now);
  const at = Number(e.at);
  // A timestamp from the future (clock change, edited save) restarts the timer rather than banking time.
  return { n: Math.min(count(e.n), ENERGY_MAX * 20), at: Number.isFinite(at) && at <= now ? at : now };
}

/**
 * Turn whatever was stored into a valid profile. Older saves lack later
 * fields (v1 has no progression, v2 no collection, energy or pass, v3 no
 * tower identity) and get the new-player values for those.
 */
export function parseSave(raw: string | null, now: number = Date.now()): SaveData {
  const d = defaults(now);
  if (!raw) return d;
  try {
    const p = JSON.parse(raw) as Partial<SaveData> | null;
    if (!p || typeof p !== 'object') return d;
    const chests = {} as Record<ChestId, number>;
    for (const id of CHEST_IDS) chests[id] = count(p.chests?.[id]);
    return {
      v: 4,
      bestFloor: count(p.bestFloor),
      runs: count(p.runs),
      tower: readTower(p.tower, now),
      settings: readSettings(p.settings),
      coins: count(p.coins),
      gems: Number.isFinite(Number(p.gems)) ? count(p.gems) : STARTER_GEMS,
      xp: count(p.xp),
      ...sanitizeMeta(p.upgrades, p.talents),
      inv: sanitizeInventory(p.inv),
      chests,
      energy: readEnergy(p.energy, now),
      pass: sanitizePass(p.pass, now),
      starterBought: Boolean(p.starterBought),
      adChest: { day: count(p.adChest?.day), used: count(p.adChest?.used) },
      rng: Number.isFinite(Number(p.rng)) ? Number(p.rng) | 0 : d.rng,
    };
  } catch {
    return d;
  }
}

/**
 * Wipe all progress in place: currencies, upgrades, talents, orbs, chests,
 * pass, records. Settings are kept, and so is the leaderboard identity, so the
 * player does not reappear on this week's board as a stranger.
 */
export function resetProgress(save: SaveData, now: number = Date.now()): void {
  const fresh = defaults(now);
  fresh.settings = { ...save.settings };
  fresh.tower = { ...fresh.tower, playerId: save.tower.playerId, name: save.tower.name };
  Object.assign(save, fresh);
}

export function loadSave(): SaveData {
  try {
    return parseSave(localStorage.getItem(KEY));
  } catch {
    return defaults(Date.now());
  }
}

export function writeSave(data: SaveData): void {
  const json = JSON.stringify(data);
  try {
    localStorage.setItem(KEY, json);
  } catch {
    // Private mode or storage full: the game still plays, it just will not persist.
  }
  mirror?.(KEY, json);
}
