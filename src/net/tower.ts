/**
 * Client for the leaderboard server (see server/api.ts). In development the
 * Vite dev server proxies /api to it; a deployed build sets VITE_API_URL.
 */
import type { TowerScore } from '../sim/tower';
import type { RunInput } from '../sim/types';

export interface BoardRow {
  rank: number;
  name: string;
  floor: number;
  kills: number;
  you: boolean;
}

export interface Board {
  week: number;
  total: number;
  top: BoardRow[];
  you: BoardRow | null;
}

export interface Submission {
  week: number;
  playerId: string;
  name: string;
  simVersion: number;
  log: RunInput[];
}

export type SubmitResult =
  | { ok: true; floor: number; kills: number; improved: boolean; rank: number; total: number; best: TowerScore | null }
  /** `retry` is true when sending the same run again later could work. */
  | { ok: false; error: string; message: string; retry: boolean };

export interface TowerApi {
  board(week: number, playerId: string): Promise<Board>;
  submit(run: Submission): Promise<SubmitResult>;
}

const TIMEOUT_MS = 8000;

export class HttpTowerApi implements TowerApi {
  constructor(private base: string = (import.meta.env?.VITE_API_URL as string | undefined) ?? '') {}

  private async call(path: string, init?: RequestInit): Promise<Response> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
      return await fetch(this.base + path, { ...init, signal: abort.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Throws if the server cannot be reached or answers with an error. */
  async board(week: number, playerId: string): Promise<Board> {
    const res = await this.call(`/api/leaderboard?week=${week}&player=${encodeURIComponent(playerId)}`);
    if (!res.ok) throw new Error(`leaderboard ${res.status}`);
    return (await res.json()) as Board;
  }

  /** Throws only if the server cannot be reached. A refusal comes back as `ok: false`. */
  async submit(run: Submission): Promise<SubmitResult> {
    const res = await this.call('/api/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(run),
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; message?: string } | null;
    if (res.ok && data?.ok) return data as SubmitResult;
    return {
      ok: false,
      error: data?.error ?? 'server',
      message: data?.message ?? 'The leaderboard had a problem.',
      // Rate limits and server faults pass; a rejected run never will.
      retry: res.status === 429 || res.status >= 500,
    };
  }
}
