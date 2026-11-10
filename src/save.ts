/** Persistent profile, kept in localStorage. */
export interface SaveData {
  v: 1;
  bestFloor: number;
  coins: number;
  gems: number;
  runs: number;
  settings: { muted: boolean; speed: number };
}

const KEY = 'shatter-dungeon-save-v1';

/** New players start with enough gems for two revives. */
export const STARTER_GEMS = 100;

function defaults(): SaveData {
  return { v: 1, bestFloor: 0, coins: 0, gems: STARTER_GEMS, runs: 0, settings: { muted: false, speed: 1 } };
}

export function loadSave(): SaveData {
  const d = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const p = JSON.parse(raw) as Partial<SaveData>;
    return {
      v: 1,
      bestFloor: Number(p.bestFloor) || 0,
      coins: Number(p.coins) || 0,
      gems: Number.isFinite(Number(p.gems)) ? Number(p.gems) : d.gems,
      runs: Number(p.runs) || 0,
      settings: { muted: Boolean(p.settings?.muted), speed: [1, 2, 4].includes(Number(p.settings?.speed)) ? Number(p.settings?.speed) : 1 },
    };
  } catch {
    return d;
  }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Private mode or storage full: the game still plays, it just will not persist.
  }
}
