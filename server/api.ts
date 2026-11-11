/**
 * The leaderboard API as plain functions: a request in, a status and JSON
 * out. No HTTP library and no Node APIs, so the same code can sit behind
 * node:http (main.ts), a serverless function or an edge worker.
 *
 *   GET  /api/tower                      this week's number, end time, rules version
 *   GET  /api/leaderboard?week=&player=  top scores, and the caller's own rank
 *   POST /api/scores                     submit a run; the server replays it to get the score
 */
import { isRunInput, REPLAY_LIMITS } from '../src/sim/replay';
import { SIM_VERSION, cleanName, compareScores, towerWeek, verifyTowerRun, weekEndsAt } from '../src/sim/tower';
import type { RunInput } from '../src/sim/types';
import type { ScoreEntry, ScoreStore } from './store';

export interface ApiRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  /** Parsed JSON body, if any. */
  body: unknown;
  /** Caller address, for rate limiting. */
  ip: string;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

export interface ApiDeps {
  store: ScoreStore;
  now(): number;
  /** Rows returned by the leaderboard. */
  topSize?: number;
  /** Score submissions allowed per address per minute. */
  submitsPerMinute?: number;
}

export interface BoardRow {
  rank: number;
  name: string;
  floor: number;
  kills: number;
  you: boolean;
}

const PLAYER_ID = /^[A-Za-z0-9-]{8,64}$/;

const json = (status: number, body: unknown): ApiResponse => ({ status, body });
const error = (status: number, code: string, message: string): ApiResponse => json(status, { ok: false, error: code, message });

function ranked(entries: ScoreEntry[]): ScoreEntry[] {
  return entries.slice().sort((a, b) => compareScores(b, a) || a.at - b.at || (a.playerId < b.playerId ? -1 : 1));
}

export function createApi(deps: ApiDeps): (req: ApiRequest) => Promise<ApiResponse> {
  const topSize = deps.topSize ?? 50;
  const perMinute = deps.submitsPerMinute ?? 12;
  const recent = new Map<string, number[]>();

  /** Sliding one-minute window per address. */
  function allow(ip: string): boolean {
    const now = deps.now();
    const times = (recent.get(ip) ?? []).filter((t) => now - t < 60_000);
    if (times.length >= perMinute) {
      recent.set(ip, times);
      return false;
    }
    times.push(now);
    recent.set(ip, times);
    if (recent.size > 5000) for (const [k, v] of recent) if (v.every((t) => now - t >= 60_000)) recent.delete(k);
    return true;
  }

  async function board(week: number, playerId: string): Promise<{ week: number; total: number; top: BoardRow[]; you: BoardRow | null }> {
    const all = ranked(await deps.store.list(week));
    const row = (e: ScoreEntry, i: number): BoardRow => ({ rank: i + 1, name: e.name, floor: e.floor, kills: e.kills, you: e.playerId === playerId });
    const mine = playerId ? all.findIndex((e) => e.playerId === playerId) : -1;
    return { week, total: all.length, top: all.slice(0, topSize).map(row), you: mine >= 0 ? row(all[mine], mine) : null };
  }

  async function submit(req: ApiRequest): Promise<ApiResponse> {
    if (!allow(req.ip)) return error(429, 'slow_down', 'Too many submissions. Try again in a minute.');
    const b = req.body as { week?: unknown; playerId?: unknown; name?: unknown; simVersion?: unknown; log?: unknown } | null;
    if (!b || typeof b !== 'object') return error(400, 'bad_request', 'Expected a JSON object.');
    if (b.simVersion !== SIM_VERSION) return error(409, 'version', 'This game version is out of date for the leaderboard.');
    const week = towerWeek(deps.now());
    if (b.week !== week) return error(409, 'week', 'That tower week has ended.');
    if (typeof b.playerId !== 'string' || !PLAYER_ID.test(b.playerId)) return error(400, 'bad_request', 'Bad player id.');
    const name = cleanName(b.name);
    if (!name) return error(400, 'name', 'Names need 3 to 16 letters or numbers.');
    if (!Array.isArray(b.log) || b.log.length > REPLAY_LIMITS.maxInputs || !b.log.every(isRunInput)) {
      return error(400, 'bad_request', 'Bad run log.');
    }

    // The score is whatever the replay says, never what the client claims.
    const verdict = verifyTowerRun(week, b.log as RunInput[]);
    if (!verdict.ok) return error(422, 'invalid_run', `Run could not be verified: ${verdict.error}.`);

    const previous = await deps.store.get(week, b.playerId);
    const improved = !previous || compareScores(verdict, previous) > 0;
    if (improved) {
      await deps.store.put(week, { playerId: b.playerId, name, floor: verdict.floor, kills: verdict.kills, turns: verdict.turns, at: deps.now() });
    } else if (previous.name !== name) {
      await deps.store.put(week, { ...previous, name });
    }
    const after = await board(week, b.playerId);
    return json(200, {
      ok: true,
      floor: verdict.floor,
      kills: verdict.kills,
      improved,
      rank: after.you?.rank ?? 0,
      total: after.total,
      best: after.you ? { floor: after.you.floor, kills: after.you.kills } : null,
    });
  }

  return async (req) => {
    if (req.path === '/api/tower' && req.method === 'GET') {
      const now = deps.now();
      const week = towerWeek(now);
      return json(200, { week, endsAt: weekEndsAt(week), now, simVersion: SIM_VERSION });
    }
    if (req.path === '/api/leaderboard' && req.method === 'GET') {
      const current = towerWeek(deps.now());
      const week = req.query.week === undefined ? current : Number(req.query.week);
      if (!Number.isInteger(week) || week < 1 || week > current) return error(400, 'bad_request', 'Bad week.');
      const player = req.query.player ?? '';
      return json(200, await board(week, PLAYER_ID.test(player) ? player : ''));
    }
    if (req.path === '/api/scores' && req.method === 'POST') return submit(req);
    return error(404, 'not_found', 'No such endpoint.');
  };
}
