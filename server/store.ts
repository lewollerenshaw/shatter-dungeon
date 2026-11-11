import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** One player's best run of a week. */
export interface ScoreEntry {
  playerId: string;
  name: string;
  floor: number;
  kills: number;
  turns: number;
  /** When this score was set (ms since epoch). Earlier wins a tie. */
  at: number;
}

/** Where scores live. Async so it can sit in front of any database. */
export interface ScoreStore {
  list(week: number): Promise<ScoreEntry[]>;
  get(week: number, playerId: string): Promise<ScoreEntry | null>;
  put(week: number, entry: ScoreEntry): Promise<void>;
}

type Weeks = Record<string, Record<string, ScoreEntry>>;

export class MemoryStore implements ScoreStore {
  protected weeks: Weeks = {};

  async list(week: number): Promise<ScoreEntry[]> {
    return Object.values(this.weeks[week] ?? {});
  }

  async get(week: number, playerId: string): Promise<ScoreEntry | null> {
    return this.weeks[week]?.[playerId] ?? null;
  }

  async put(week: number, entry: ScoreEntry): Promise<void> {
    (this.weeks[week] ??= {})[entry.playerId] = entry;
  }
}

/**
 * Scores in one JSON file. Fine for a single small server; swap in a real
 * database behind ScoreStore before running more than one instance.
 */
export class FileStore extends MemoryStore {
  private saving: Promise<void> = Promise.resolve();

  private constructor(private path: string) {
    super();
  }

  static async open(path: string): Promise<FileStore> {
    const store = new FileStore(path);
    try {
      const data: unknown = JSON.parse(await readFile(path, 'utf8'));
      if (data && typeof data === 'object') store.weeks = data as Weeks;
    } catch (err) {
      // No file yet is normal; anything else should not be silently overwritten.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    return store;
  }

  override async put(week: number, entry: ScoreEntry): Promise<void> {
    await super.put(week, entry);
    // Writes queue behind each other, and go through a temp file so a crash cannot leave half a file.
    this.saving = this.saving.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      await writeFile(tmp, JSON.stringify(this.weeks));
      await rename(tmp, this.path);
    });
    await this.saving;
  }
}
