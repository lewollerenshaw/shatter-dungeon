import { describe, expect, it } from 'vitest';
import { defaultSettings, parseSave, resetProgress } from '../src/save';
import { grantProduct } from '../src/sim/store';
import { TOWER_EPOCH, WEEK_MS } from '../src/sim/tower';

const NOW = TOWER_EPOCH + 9 * WEEK_MS;

describe('settings', () => {
  it('a new player gets sound, shake, vibration and glow on, at normal speed', () => {
    expect(parseSave(null, NOW).settings).toEqual({ muted: false, speed: 1, shake: true, haptics: true, glow: true, dev: false });
    expect(defaultSettings()).toEqual(parseSave(null, NOW).settings);
  });

  it('an older save keeps its sound and speed and gets the newer settings switched on', () => {
    const s = parseSave(JSON.stringify({ v: 3, settings: { muted: true, speed: 4 } }), NOW);
    expect(s.settings).toEqual({ muted: true, speed: 4, shake: true, haptics: true, glow: true, dev: false });
  });

  it('keeps choices that were switched off', () => {
    const raw = { settings: { muted: false, speed: 2, shake: false, haptics: false, glow: false, dev: true } };
    expect(parseSave(JSON.stringify(raw), NOW).settings).toEqual(raw.settings);
  });

  it('repairs nonsense', () => {
    const s = parseSave(JSON.stringify({ settings: { muted: 'yes', speed: 3, shake: 0, dev: 'true' } }), NOW);
    // Only real booleans count: a stray value never mutes the game or turns developer mode on.
    expect(s.settings).toMatchObject({ muted: false, speed: 1, shake: true, dev: false });
    expect(parseSave(JSON.stringify({ settings: 'loud' }), NOW).settings).toEqual(defaultSettings());
  });
});

describe('reset progress', () => {
  it('erases progress but keeps settings and the leaderboard identity', () => {
    const save = parseSave(null, NOW);
    grantProduct(save, 'starter_pack');
    save.coins = 9999;
    save.xp = 5000;
    save.bestFloor = 31;
    save.runs = 40;
    save.upgrades = { f_damage: 10 };
    save.talents = { honed: 3 };
    save.inv.fire = [5, 2, 1, 0, 0, 0, 0];
    save.settings = { ...save.settings, muted: true, speed: 4 };
    save.tower.name = 'Ada';
    save.tower.best = { floor: 12, kills: 300 };
    const id = save.tower.playerId;

    resetProgress(save, NOW + 1000);

    const fresh = parseSave(null, NOW);
    expect(save).toMatchObject({ coins: 0, gems: fresh.gems, xp: 0, bestFloor: 0, runs: 0, upgrades: {}, talents: {}, starterBought: false });
    expect(save.inv).toEqual(fresh.inv);
    expect(save.chests).toEqual({ wood: 0, silver: 0, gold: 0 });
    expect(save.settings).toMatchObject({ muted: true, speed: 4 });
    expect(save.tower).toMatchObject({ playerId: id, name: 'Ada', best: null, pending: null });
    // And it survives a save and load.
    expect(parseSave(JSON.stringify(save), NOW + 2000)).toEqual(save);
  });
});
