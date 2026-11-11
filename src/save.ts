import { ENERGY_MAX, newEnergy, type EnergyState } from './sim/energy';
import { sanitizeMeta } from './sim/meta';
import { CHEST_IDS, sanitizeInventory, type ChestId } from './sim/orbs';
import { sanitizePass } from './sim/pass';
import { STARTER_GEMS, newWallet, type Wallet } from './sim/store';

/** Persistent profile, kept in localStorage. */
export interface SaveData extends Wallet {
  v: 3;
  bestFloor: number;
  runs: number;
  settings: { muted: boolean; speed: number };
}

/** The key keeps its original name so saves from earlier versions still load. */
const KEY = 'shatter-dungeon-save-v1';

function defaults(now: number): SaveData {
  const seed = (now ^ (Math.random() * 0x7fffffff)) | 0;
  return { v: 3, bestFloor: 0, runs: 0, settings: { muted: false, speed: 1 }, ...newWallet(now, seed) };
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
 * fields (v1 has no progression, v2 no collection, energy or pass) and get
 * the new-player values for those.
 */
export function parseSave(raw: string | null, now: number = Date.now()): SaveData {
  const d = defaults(now);
  if (!raw) return d;
  try {
    const p = JSON.parse(raw) as Partial<SaveData> | null;
    if (!p || typeof p !== 'object') return d;
    const speed = Number(p.settings?.speed);
    const chests = {} as Record<ChestId, number>;
    for (const id of CHEST_IDS) chests[id] = count(p.chests?.[id]);
    return {
      v: 3,
      bestFloor: count(p.bestFloor),
      runs: count(p.runs),
      settings: { muted: Boolean(p.settings?.muted), speed: [1, 2, 4].includes(speed) ? speed : 1 },
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

export function loadSave(): SaveData {
  try {
    return parseSave(localStorage.getItem(KEY));
  } catch {
    return defaults(Date.now());
  }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Private mode or storage full: the game still plays, it just will not persist.
  }
}
