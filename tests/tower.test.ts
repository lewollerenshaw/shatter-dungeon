import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApi, type ApiResponse } from '../server/api';
import { FileStore, MemoryStore } from '../server/store';
import { parseSave } from '../src/save';
import { dcos, dsin, ipow, length } from '../src/sim/dmath';
import { metaAt } from '../src/sim/meta';
import { rollPerks } from '../src/sim/perks';
import { isRunInput, replay } from '../src/sim/replay';
import { Run } from '../src/sim/run';
import {
  REFERENCE,
  SIM_VERSION,
  TOWER_EPOCH,
  TOWER_META,
  WEEK_MS,
  cleanName,
  compareScores,
  scriptedRun,
  simMatchesReference,
  towerSeed,
  towerWeek,
  verifyTowerRun,
  weekEndsAt,
} from '../src/sim/tower';
import type { RunInput } from '../src/sim/types';

const NOW = TOWER_EPOCH + 9 * WEEK_MS + 3 * 3600 * 1000;
const WEEK = towerWeek(NOW);
const tower = { tower: true };
/** Finished tower runs for this week from the scripted player, strongest first is not guaranteed. */
const runs = [0, 1, 2].map((v) => scriptedRun(towerSeed(WEEK), TOWER_META, tower, v));

describe('deterministic maths', () => {
  it('sin and cos match the built-ins to the last few digits', () => {
    for (let i = -400; i <= 400; i++) {
      const x = i * 0.0173;
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(1e-14);
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThan(1e-14);
    }
    expect(dsin(0)).toBe(0);
    expect(dcos(0)).toBe(1);
  });

  it('whole-number powers and lengths', () => {
    expect(ipow(2, 10)).toBe(1024);
    expect(ipow(7, 0)).toBe(1);
    for (const n of [1, 5, 19, 60, 400]) expect(ipow(1.25, n) / Math.pow(1.25, n)).toBeCloseTo(1, 12);
    expect(length(3, 4)).toBe(5);
  });
});

describe('replay', () => {
  it('reproduces a run exactly from its seed and input log', () => {
    for (const meta of [metaAt(0), metaAt(1)]) {
      const live = scriptedRun(4242, meta, {}, 1, 60);
      expect(live.log.some((e) => e[0] === 'c')).toBe(true);
      const again = replay(4242, meta, {}, live.log);
      if (!again.ok) throw new Error(again.error);
      expect(JSON.stringify(again.run.s)).toBe(JSON.stringify(live.s));
      expect(again.run.log).toEqual(live.log);
      expect(again.finished).toBe(live.s.phase === 'dead');
    }
  });

  it('survives a trip through JSON', () => {
    const live = runs[0];
    const log = JSON.parse(JSON.stringify(live.log)) as RunInput[];
    expect(log.every(isRunInput)).toBe(true);
    const again = replay(towerSeed(WEEK), TOWER_META, tower, log);
    expect(again).toMatchObject({ ok: true, finished: true, floor: live.s.floor, kills: live.s.stats.kills });
  });

  it('includes a revive in a normal run', () => {
    const run = scriptedRun(77, metaAt(0), {}, 0);
    expect(run.s.phase).toBe('dead');
    expect(run.revive()).toBe(true);
    const again = replay(77, metaAt(0), {}, run.log);
    if (!again.ok) throw new Error(again.error);
    expect(again.finished).toBe(false);
    expect(again.run.s.revived).toBe(true);
    expect(JSON.stringify(again.run.s)).toBe(JSON.stringify(run.s));
  });

  it('rejects logs that could not have happened', () => {
    const log = runs[0].log;
    const bad = (l: RunInput[]): string => {
      const r = replay(towerSeed(WEEK), TOWER_META, tower, l);
      return r.ok ? 'accepted' : r.error;
    };
    expect(bad([['f', 1.2]])).toMatch(/illegal input 0/); // firing before choosing an orb
    expect(bad([['p', 9]])).toMatch(/illegal input 0/);
    expect(bad([['p', 0], ['c', 0]])).toMatch(/illegal input 1/); // recall with nothing in flight
    expect(bad([['p', 0], ['f', NaN]])).toMatch(/illegal input 1/);
    expect(bad([['p', 0], ['f', 1.2], ['c', 0]])).toMatch(/recall out of order/);
    expect(bad([...log, ['f', 1.2]])).toMatch(/illegal input/); // playing on after death
    expect(bad([...log, ['v']])).toMatch(/illegal input/); // no revive in the tower
    expect(replay(towerSeed(WEEK), TOWER_META, tower, log, { maxInputs: 10, maxSteps: 1e9 })).toEqual({ ok: false, error: 'log too long' });
    expect(replay(towerSeed(WEEK), TOWER_META, tower, log, { maxInputs: 1e9, maxSteps: 500 })).toEqual({ ok: false, error: 'run too long' });
  });

  it('knows the shape of a log entry', () => {
    for (const ok of [['f', 1.5], ['p', 2], ['r'], ['c', 1200], ['v']]) expect(isRunInput(ok)).toBe(true);
    for (const no of [null, 'f', [], ['f'], ['f', '1'], ['f', Infinity], ['p', -1], ['p', 1.5], ['r', 1], ['x', 1], ['c', 1e30]]) {
      expect(isRunInput(no)).toBe(false);
    }
  });
});

describe('weekly tower rules', () => {
  it('weeks run Monday to Monday and each has its own seed', () => {
    expect(towerWeek(TOWER_EPOCH)).toBe(1);
    expect(towerWeek(TOWER_EPOCH + WEEK_MS - 1)).toBe(1);
    expect(towerWeek(TOWER_EPOCH + WEEK_MS)).toBe(2);
    expect(weekEndsAt(1)).toBe(TOWER_EPOCH + WEEK_MS);
    expect(new Date(TOWER_EPOCH).getUTCDay()).toBe(1);
    const seeds = new Set(Array.from({ length: 200 }, (_, i) => towerSeed(i + 1)));
    expect(seeds.size).toBe(200);
    expect(towerSeed(WEEK)).toBe(towerSeed(WEEK));
  });

  it('gives one life and offers no coin perk', () => {
    const run = runs[0];
    expect(run.s.phase).toBe('dead');
    expect(run.revive()).toBe(false);
    const fresh = new Run(5, TOWER_META, tower);
    fresh.choosePerk(0);
    for (let i = 0; i < 300; i++) expect(rollPerks(fresh.s, 'floor', 4)).not.toContain('gold_rush');
    const normal = new Run(5, TOWER_META);
    normal.choosePerk(0);
    let seen = false;
    for (let i = 0; i < 300 && !seen; i++) seen = rollPerks(normal.s, 'floor', 4).includes('gold_rush');
    expect(seen).toBe(true);
  });

  it('verifies a finished run and refuses an unfinished one', () => {
    const run = runs[1];
    expect(verifyTowerRun(WEEK, run.log)).toEqual({ ok: true, floor: run.s.floor, kills: run.s.stats.kills, turns: run.s.stats.turns });
    expect(verifyTowerRun(WEEK, run.log.slice(0, 20))).toEqual({ ok: false, error: 'run not finished' });
    // The same inputs on another week's tower are a different run.
    const other = verifyTowerRun(WEEK + 1, run.log);
    expect(other.ok && other.floor === run.s.floor && other.kills === run.s.stats.kills).toBe(false);
  });

  it('ranks by floor, then by blocks shattered', () => {
    expect(compareScores({ floor: 12, kills: 10 }, { floor: 11, kills: 900 })).toBeGreaterThan(0);
    expect(compareScores({ floor: 12, kills: 10 }, { floor: 12, kills: 11 })).toBeLessThan(0);
    expect(compareScores({ floor: 12, kills: 10 }, { floor: 12, kills: 10 })).toBe(0);
  });

  it('tidies names', () => {
    expect(cleanName('  Ada   Lovelace  ')).toBe('Ada Lovelace');
    expect(cleanName('<b>x</b>!!')).toBe('bxb');
    expect(cleanName('Zoë_99')).toBe('Zoë_99');
    expect(cleanName('a'.repeat(40))).toHaveLength(16);
    expect(cleanName('ab')).toBeNull();
    expect(cleanName('   ')).toBeNull();
    expect(cleanName(42)).toBeNull();
  });

  // If this fails after a change to the simulation, old replays no longer
  // hold: update REFERENCE in src/sim/tower.ts and bump SIM_VERSION.
  it('the reference run still scores what was recorded', () => {
    const r = scriptedRun(REFERENCE.seed, TOWER_META, tower).s;
    expect({ floor: r.floor, kills: r.stats.kills, ticks: r.ticks }).toEqual({ floor: REFERENCE.floor, kills: REFERENCE.kills, ticks: REFERENCE.ticks });
    expect(simMatchesReference()).toBe(true);
  });
});

describe('leaderboard server', () => {
  const setup = (opts: { submitsPerMinute?: number } = {}) => {
    const store = new MemoryStore();
    const clock = { now: NOW };
    const api = createApi({ store, now: () => clock.now, topSize: 2, ...opts });
    const get = (path: string, query: Record<string, string> = {}): Promise<ApiResponse> =>
      api({ method: 'GET', path, query, body: null, ip: '1.1.1.1' });
    const post = (body: unknown, ip = '1.1.1.1'): Promise<ApiResponse> => api({ method: 'POST', path: '/api/scores', query: {}, body, ip });
    const entry = (n: number, over: Record<string, unknown> = {}) => ({
      week: WEEK,
      playerId: `player-000${n}`,
      name: `Player ${n}`,
      simVersion: SIM_VERSION,
      log: runs[n].log,
      ...over,
    });
    return { store, clock, get, post, entry };
  };
  const scoreOf = (n: number) => ({ floor: runs[n].s.floor, kills: runs[n].s.stats.kills });

  it('reports the current week', async () => {
    const { get } = setup();
    expect(await get('/api/tower')).toEqual({ status: 200, body: { week: WEEK, endsAt: weekEndsAt(WEEK), now: NOW, simVersion: SIM_VERSION } });
    expect((await get('/api/nope')).status).toBe(404);
  });

  it('scores a run by replaying it, whatever the client claims', async () => {
    const { post, entry } = setup();
    const res = await post(entry(0, { floor: 999, kills: 99999, score: 1e9 }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, ...scoreOf(0), improved: true, rank: 1, total: 1, best: scoreOf(0) });
  });

  it('ranks players, keeps only their best, and hides ids', async () => {
    const { post, get, entry } = setup();
    for (const n of [0, 1, 2]) expect((await post(entry(n))).status).toBe(200);
    const order = [0, 1, 2].sort((a, b) => compareScores(scoreOf(b), scoreOf(a)));
    const worst = order[2];

    const board = (await get('/api/leaderboard', { player: `player-000${worst}` })).body as {
      total: number;
      top: { rank: number; name: string; floor: number; you: boolean }[];
      you: { rank: number; name: string } | null;
    };
    expect(board.total).toBe(3);
    expect(board.top.map((r) => r.name)).toEqual([`Player ${order[0]}`, `Player ${order[1]}`]);
    expect(board.top.map((r) => r.rank)).toEqual([1, 2]);
    expect(board.top.some((r) => r.you)).toBe(false);
    expect(board.you).toMatchObject({ rank: 3, name: `Player ${worst}` });
    expect(JSON.stringify(board)).not.toContain('player-000');

    // The best player sends a worse run under a new name: the score stays, the name changes.
    const again = await post(entry(worst, { playerId: `player-000${order[0]}`, name: 'Renamed' }));
    expect(again.body).toMatchObject({ ok: true, improved: false, rank: 1, best: scoreOf(order[0]) });
    const after = (await get('/api/leaderboard')).body as { total: number; top: { name: string }[]; you: unknown };
    expect(after.total).toBe(3);
    expect(after.top[0].name).toBe('Renamed');
    expect(after.you).toBeNull();
  });

  it('refuses bad submissions', async () => {
    const { post, entry, clock, get } = setup();
    expect(await post(entry(0, { simVersion: SIM_VERSION + 1 }))).toMatchObject({ status: 409, body: { error: 'version' } });
    expect(await post(entry(0, { week: WEEK - 1 }))).toMatchObject({ status: 409, body: { error: 'week' } });
    expect(await post(entry(0, { name: '!!' }))).toMatchObject({ status: 400, body: { error: 'name' } });
    expect(await post(entry(0, { playerId: 'x' }))).toMatchObject({ status: 400 });
    expect(await post(entry(0, { log: 'nope' }))).toMatchObject({ status: 400 });
    expect(await post(entry(0, { log: [['f', 'up']] }))).toMatchObject({ status: 400 });
    expect(await post(entry(0, { log: runs[0].log.slice(0, 30) }))).toMatchObject({ status: 422, body: { error: 'invalid_run' } });
    expect(await post(entry(0, { log: [...runs[0].log, ['f', 1]] }))).toMatchObject({ status: 422 });
    expect(await post(null)).toMatchObject({ status: 400 });
    expect((await get('/api/leaderboard')).body).toMatchObject({ total: 0, top: [] });
    expect((await get('/api/leaderboard', { week: String(WEEK + 1) })).status).toBe(400);

    // A run from this week is refused once the week has rolled over.
    clock.now = NOW + WEEK_MS;
    expect(await post(entry(0))).toMatchObject({ status: 409, body: { error: 'week' } });
  });

  it('limits how often one address can submit', async () => {
    const { post, entry, clock } = setup({ submitsPerMinute: 2 });
    expect((await post(entry(0))).status).toBe(200);
    expect((await post(entry(1))).status).toBe(200);
    expect(await post(entry(2))).toMatchObject({ status: 429, body: { error: 'slow_down' } });
    expect((await post(entry(2), '2.2.2.2')).status).toBe(200);
    clock.now += 61_000;
    expect((await post(entry(2))).status).toBe(200);
  });

  it('keeps scores on disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shatter-'));
    try {
      const file = join(dir, 'nested', 'scores.json');
      const store = await FileStore.open(file);
      await store.put(3, { playerId: 'player-0001', name: 'Ada', floor: 12, kills: 300, turns: 90, at: 5 });
      await store.put(3, { playerId: 'player-0002', name: 'Bo', floor: 9, kills: 100, turns: 70, at: 6 });
      expect(JSON.parse(await readFile(file, 'utf8'))['3']['player-0001'].floor).toBe(12);
      const reopened = await FileStore.open(file);
      expect(await reopened.list(3)).toHaveLength(2);
      expect(await reopened.get(3, 'player-0002')).toMatchObject({ name: 'Bo', floor: 9 });
      expect(await reopened.get(4, 'player-0002')).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('save file with the tower', () => {
  it('gives an older save an identity, and keeps it', () => {
    const s = parseSave(JSON.stringify({ v: 3, coins: 10 }), NOW);
    expect(s.v).toBe(4);
    expect(s.tower.playerId).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    expect(cleanName(s.tower.name)).toBe(s.tower.name);
    expect(s.tower).toMatchObject({ week: WEEK, best: null, pending: null });

    s.tower.name = 'Ada';
    s.tower.best = { floor: 14, kills: 400 };
    s.tower.pending = { week: WEEK, log: runs[2].log };
    const back = parseSave(JSON.stringify(s), NOW + 1000);
    expect(back.tower).toEqual(s.tower);
  });

  it('drops last week\'s score but not the player', () => {
    const s = parseSave(null, NOW);
    s.tower.best = { floor: 14, kills: 400 };
    s.tower.pending = { week: WEEK, log: runs[2].log };
    const next = parseSave(JSON.stringify(s), NOW + WEEK_MS);
    expect(next.tower).toEqual({ playerId: s.tower.playerId, name: s.tower.name, week: WEEK + 1, best: null, pending: null });
  });

  it('repairs damaged tower data', () => {
    const s = parseSave(JSON.stringify({ tower: { playerId: '<script>', name: '!', week: WEEK, best: { floor: 'x' }, pending: { week: WEEK, log: [['z']] } } }), NOW);
    expect(s.tower.playerId).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    expect(s.tower.name.length).toBeGreaterThanOrEqual(3);
    expect(s.tower.best).toBeNull();
    expect(s.tower.pending).toBeNull();
  });
});
