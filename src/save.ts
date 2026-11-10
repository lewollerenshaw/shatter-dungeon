import { sanitizeMeta, type Profile } from './sim/meta';

/** Persistent profile, kept in localStorage. */
export interface SaveData extends Profile {
  v: 2;
  bestFloor: number;
  gems: number;
  runs: number;
  settings: { muted: boolean; speed: number };
}

/** The key keeps its original name so saves from before meta-progression still load. */
const KEY = 'shatter-dungeon-save-v1';

/** New players start with enough gems for two revives. */
export const STARTER_GEMS = 100;

function defaults(): SaveData {
  return {
    v: 2,
    bestFloor: 0,
    coins: 0,
    gems: STARTER_GEMS,
    runs: 0,
    xp: 0,
    upgrades: {},
    talents: {},
    settings: { muted: false, speed: 1 },
  };
}

const count = (n: unknown): number => Math.max(0, Math.floor(Number(n)) || 0);

/** Turn whatever was stored (including a v1 save, which has no progression) into a valid profile. */
export function parseSave(raw: string | null): SaveData {
  const d = defaults();
  if (!raw) return d;
  try {
    const p = JSON.parse(raw) as Partial<SaveData> | null;
    if (!p || typeof p !== 'object') return d;
    const speed = Number(p.settings?.speed);
    return {
      v: 2,
      bestFloor: count(p.bestFloor),
      coins: count(p.coins),
      gems: Number.isFinite(Number(p.gems)) ? count(p.gems) : d.gems,
      runs: count(p.runs),
      xp: count(p.xp),
      ...sanitizeMeta(p.upgrades, p.talents),
      settings: { muted: Boolean(p.settings?.muted), speed: [1, 2, 4].includes(speed) ? speed : 1 },
    };
  } catch {
    return d;
  }
}

export function loadSave(): SaveData {
  try {
    return parseSave(localStorage.getItem(KEY));
  } catch {
    return defaults();
  }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Private mode or storage full: the game still plays, it just will not persist.
  }
}
