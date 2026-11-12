import './style.css';
import { AimInput } from './input';
import { HttpTowerApi, type Board, type TowerApi } from './net/tower';
import { createPlatform } from './platform/index';
import { AD_PLACEMENTS, type Platform } from './platform/platform';
import { SIMULATED_AD_MS } from './platform/simulated';
import { SAVE_KEY, SPEEDS, loadSave, resetProgress, setSaveMirror, writeSave } from './save';
import { addEnergy, spendEnergy } from './sim/energy';
import {
  buyUpgrade,
  freePoints,
  learnTalent,
  levelInfo,
  metaAt,
  resetTalents,
  shopHasOffer,
  xpForRun,
  type ShopId,
} from './sim/meta';
import { anyMergeable, mergeAll, mergeOnce } from './sim/orbs';
import { claimableCount, syncPass } from './sim/pass';
import {
  buyChest,
  claimAdChest,
  claimAllPass,
  claimPassReward,
  grantProduct,
  heldChests,
  openChest,
  refillEnergy,
  runMeta,
  settleRun,
} from './sim/store';
import {
  SIM_VERSION,
  TOWER_META,
  cleanName,
  compareScores,
  simMatchesReference,
  towerSeed,
  towerWeek,
  weekEndsAt,
} from './sim/tower';
import { Run } from './sim/run';
import { H, REVIVE_GEM_COST, W, type Phase } from './sim/types';
import { Sfx } from './view/audio';
import { Fx, setHaptics } from './view/fx';
import { showShop, showTalents } from './view/hub';
import { showLeaveRun, showPause, showSettings } from './view/menus';
import { Renderer } from './view/renderer';
import { mirrorToDevice, restoreFromDevice } from './storage';
import { Screens } from './view/screens';
import { energyText, showEnergy, showOrbs, showPass, showStore } from './view/store';
import { formatLeft, showTower, showTowerResults } from './view/tower';

const stage = document.getElementById('stage') as HTMLDivElement;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLDivElement;

const platform: Platform = await createPlatform();
// Prices and ads arrive in the background; the screens that need them ask when they open.
void platform.ready();
const towerApi: TowerApi = new HttpTowerApi();
await restoreFromDevice(SAVE_KEY);
setSaveMirror(mirrorToDevice);
const save = loadSave();
const sfx = new Sfx();
const fx = new Fx();
const renderer = new Renderer(canvas);

/** Developer mode exists only in development builds (npm run dev), never on the live site or in the apps. */
const DEV_ALLOWED = import.meta.env.DEV;
const devOn = (): boolean => DEV_ALLOWED && save.settings.dev;
/** Set once this device has shown it cannot keep up with the glow pass. */
let slowDevice = false;

/** Push the saved settings into audio, effects and the renderer. */
function applySettings(): void {
  const s = save.settings;
  sfx.muted = s.muted;
  fx.shakeScale = s.shake ? 1 : 0;
  setHaptics(s.haptics);
  renderer.bloom = s.glow && !slowDevice;
}
applySettings();

let run: Run | null = null;
/** Bumped whenever a run starts or ends, so stale timers can tell they are stale. */
let runToken = 0;
let lastPhase: Phase | null = null;
let effectiveSpeed = 1;
/** The tower week the current run belongs to, or null for a normal run. */
let towerOfRun: number | null = null;
/** The run is frozen behind the pause menu. */
let paused = false;
/** The current run uses developer mode's maxed hero, so it banks nothing. */
let devRun = false;

const screens = new Screens(ui, {
  onSpeed: () => {
    save.settings.speed = SPEEDS[(SPEEDS.indexOf(save.settings.speed) + 1) % SPEEDS.length];
    writeSave(save);
  },
  onRecall: () => run?.recall(),
  onCorner: (mode) => {
    if (mode === 'pause') pauseRun();
    else openSettings(showTitle, false);
  },
  onClick: () => sfx.click(),
});

const aim = new AimInput(
  canvas,
  () => ({ canAim: !!run && run.s.phase === 'aim' && !screens.isOpen, launchX: run ? run.s.launchX : W / 2 }),
  (angle) => run?.fire(angle),
);

window.addEventListener('pointerdown', () => sfx.unlock(), { capture: true });

/** Measures the notch / status bar inset, which CSS knows and JavaScript otherwise does not. */
const safeProbe = document.createElement('div');
safeProbe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none';
document.body.append(safeProbe);

function layout(): void {
  const vw = window.innerWidth;
  // Keep the whole stage below the notch. The bottom inset is left alone: the
  // home indicator sits clear of the corner buttons.
  const top = safeProbe.offsetHeight;
  const vh = window.innerHeight - top;
  const s = Math.min(vw / W, vh / H);
  stage.style.transform = `translate(${((vw - W * s) / 2).toFixed(1)}px, ${(top + (vh - H * s) / 2).toFixed(1)}px) scale(${s.toFixed(4)})`;
  renderer.resize(s);
}
window.addEventListener('resize', layout);
// The inset is often still zero when the page first loads inside the app, and
// arrives without a resize event.
new ResizeObserver(layout).observe(safeProbe);
layout();

/** Run `fn` after `ms`, unless the run has changed in the meantime. */
function later(ms: number, fn: () => void): void {
  const token = runToken;
  setTimeout(() => {
    if (token === runToken) fn();
  }, ms);
}

const now = (): number => Date.now();

function showTitle(): void {
  runToken++;
  run = null;
  paused = false;
  devRun = false;
  lastPhase = null;
  fx.reset();
  renderer.reset();
  if (syncPass(save.pass, now())) writeSave(save);
  screens.showTitle(
    {
      bestFloor: save.bestFloor,
      coins: save.coins,
      gems: save.gems,
      runs: save.runs,
      level: levelInfo(save.xp).level,
      points: freePoints(save),
      forgeOffer: shopHasOffer(save, 'forge'),
      tavernOffer: shopHasOffer(save, 'tavern'),
      orbsOffer: anyMergeable(save.inv),
      chests: heldChests(save),
      passRewards: claimableCount(save.pass),
      energy: energyText(save, now()),
      towerLeft: formatLeft(weekEndsAt(towerWeek(now())) - now()),
      dev: devOn(),
    },
    {
      play: startRun,
      tower: openTower,
      forge: () => openShop('forge'),
      tavern: () => openShop('tavern'),
      talents: openTalents,
      orbs: openOrbs,
      store: openStore,
      pass: openPass,
    },
  );
}

/** Play a rewarded ad over whatever is on screen. Resolves true if the reward was earned. */
function watchAd(placement: string): Promise<boolean> {
  if (platform.simulated) screens.showAd(SIMULATED_AD_MS);
  else screens.showWait('Loading ad…');
  return platform.showRewardedAd(placement);
}

/** Buy a store product through the platform and hand it over. */
async function purchase(productId: string): Promise<boolean> {
  const result = await platform.purchase(productId);
  if (!result.ok || !grantProduct(save, productId)) return false;
  writeSave(save);
  sfx.perk();
  return true;
}

function openStore(): void {
  showStore(screens, {
    wallet: save,
    now,
    price: (id) => platform.price(id),
    simulated: platform.simulated,
    ads: platform.adsAvailable,
    buyProduct: purchase,
    buyChest: (id) => {
      if (!buyChest(save, id)) return null;
      const loot = openChest(save, id);
      writeSave(save);
      sfx.floorClear();
      return loot;
    },
    openChest: (id) => {
      const loot = openChest(save, id);
      if (loot) {
        writeSave(save);
        sfx.floorClear();
      }
      return loot;
    },
    adChest: async () => {
      if (!(await watchAd(AD_PLACEMENTS.chest)) || !claimAdChest(save, now())) return null;
      const loot = openChest(save, 'wood');
      writeSave(save);
      sfx.floorClear();
      return loot;
    },
    back: showTitle,
  });
}

function openOrbs(): void {
  const merged = (n: number): number => {
    if (n > 0) {
      writeSave(save);
      sfx.perk();
    }
    return n;
  };
  showOrbs(screens, save, {
    merge: (element) => merged(mergeOnce(save.inv, element)),
    mergeAll: () => merged(mergeAll(save.inv)),
    back: showTitle,
  });
}

function openPass(): void {
  if (syncPass(save.pass, now())) writeSave(save);
  showPass(screens, {
    wallet: save,
    now,
    price: (id) => platform.price(id),
    simulated: platform.simulated,
    claim: (track, tier) => {
      const reward = claimPassReward(save, track, tier);
      if (reward) {
        writeSave(save);
        sfx.perk();
      }
      return reward;
    },
    claimAll: () => {
      const rewards = claimAllPass(save);
      if (rewards.length > 0) {
        writeSave(save);
        sfx.perk();
      }
      return rewards;
    },
    buyPremium: () => purchase('battle_pass'),
    back: showTitle,
  });
}

/** Shown when a run cannot start for lack of energy. `then` starts it once there is some. */
function openEnergy(then: () => void): void {
  showEnergy(screens, {
    wallet: save,
    now,
    simulated: platform.simulated,
    ads: platform.adsAvailable,
    refill: () => {
      if (!refillEnergy(save, now())) return false;
      writeSave(save);
      return true;
    },
    ad: async () => {
      if (!(await watchAd(AD_PLACEMENTS.energy))) return false;
      addEnergy(save.energy, now(), 1);
      writeSave(save);
      return true;
    },
    ready: then,
    back: showTitle,
  });
}

// --------------------------------------------------------------- weekly tower

/** Forget last week's best once a new tower week begins. */
function syncTower(): void {
  const week = towerWeek(now());
  const t = save.tower;
  if (t.week === week) return;
  t.week = week;
  t.best = null;
  t.pending = null;
  writeSave(save);
}

/**
 * Send the unsent best run, if there is one. Resolves to a line for the
 * player, or '' if there was nothing to send. The run stays queued when the
 * server cannot be reached.
 */
async function flushTower(): Promise<string> {
  syncTower();
  const t = save.tower;
  const pending = t.pending;
  if (!pending) return '';
  // The server replays the run. If this browser's arithmetic differs from the
  // reference, the replay would not match, so do not send it.
  if (!simMatchesReference()) {
    t.pending = null;
    writeSave(save);
    return 'This browser plays the tower differently from the server, so its scores cannot be posted.';
  }
  try {
    const res = await towerApi.submit({ week: pending.week, playerId: t.playerId, name: t.name, simVersion: SIM_VERSION, log: pending.log });
    if (res.ok) {
      if (t.pending === pending) t.pending = null;
      writeSave(save);
      return `Rank ${res.rank} of ${res.total} this week`;
    }
    if (res.retry) return 'The leaderboard is busy. Your run is saved and will be sent later.';
    if (t.pending === pending) t.pending = null;
    writeSave(save);
    return `Not counted: ${res.message}`;
  } catch {
    return 'Leaderboard unreachable. Your run is saved and will be sent later.';
  }
}

function openTower(): void {
  syncTower();
  const t = save.tower;
  showTower(screens, {
    week: t.week,
    leftMs: weekEndsAt(t.week) - now(),
    name: t.name,
    best: t.best,
    board: async (): Promise<Board> => {
      await flushTower();
      return towerApi.board(t.week, t.playerId);
    },
    rename: (raw) => {
      const name = cleanName(raw);
      if (!name) return null;
      t.name = name;
      writeSave(save);
      return name;
    },
    climb: startTower,
    back: showTitle,
  });
}

function startTower(): void {
  if (!spendEnergy(save.energy, now())) {
    openEnergy(startTower);
    return;
  }
  syncTower();
  runToken++;
  paused = false;
  devRun = false;
  fx.reset();
  renderer.reset();
  screens.close();
  towerOfRun = save.tower.week;
  run = new Run(towerSeed(towerOfRun), TOWER_META, { tower: true });
  lastPhase = null;
  save.runs++;
  writeSave(save);
}

function endTowerRun(r: Run): void {
  r.end();
  syncTower();
  const t = save.tower;
  const score = { floor: r.s.floor, kills: r.s.stats.kills };
  const out = settleRun(save, { coins: 0, gems: 0, floor: r.s.floor, bossKills: r.s.stats.bossKills, chests: 0 }, now());
  const sameWeek = towerOfRun === t.week;
  const newBest = sameWeek && (!t.best || compareScores(score, t.best) > 0);
  if (newBest) {
    t.best = score;
    t.pending = { week: t.week, log: r.log.slice() };
  }
  writeSave(save);
  runToken++;
  const setStatus = showTowerResults(
    screens,
    {
      floor: score.floor,
      kills: score.kills,
      turns: r.s.stats.turns,
      xp: out.xp,
      level: out.level,
      levelsGained: out.levelsGained,
      best: t.best,
      newBest,
    },
    { again: startTower, board: openTower, title: showTitle },
  );
  if (!sameWeek) {
    setStatus('That tower week ended while you were climbing.');
  } else if (newBest) {
    setStatus('Sending your run to the leaderboard…');
    void flushTower().then(setStatus);
  } else {
    setStatus('Not a new best, so the leaderboard is unchanged.');
  }
}

function openShop(shop: ShopId): void {
  showShop(screens, shop, save, {
    buy: (id) => {
      if (!buyUpgrade(save, id)) return false;
      writeSave(save);
      sfx.perk();
      return true;
    },
    back: showTitle,
  });
}

function openTalents(): void {
  showTalents(screens, save, {
    learn: (id) => {
      if (!learnTalent(save, id)) return false;
      writeSave(save);
      sfx.perk();
      return true;
    },
    reset: () => {
      resetTalents(save);
      writeSave(save);
    },
    back: showTitle,
  });
}

function startRun(): void {
  const dev = devOn();
  // Every descent costs one energy, except in developer mode.
  if (!dev && !spendEnergy(save.energy, now())) {
    openEnergy(startRun);
    return;
  }
  towerOfRun = null;
  paused = false;
  devRun = dev;
  runToken++;
  fx.reset();
  renderer.reset();
  screens.close();
  run = new Run((Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0, dev ? metaAt(1) : runMeta(save));
  lastPhase = null;
  if (dev) return;
  save.runs++;
  writeSave(save);
}

function showPerks(): void {
  const r = run;
  // A delayed call can land while the pause menu is up; resuming shows the cards instead.
  if (!r || paused || r.s.phase !== 'perk' || !r.s.perkChoices) return;
  screens.showPerks(
    r.s.perkChoices,
    r.s.perkReason,
    r.s.floor,
    r.s.perks,
    (i) => r.choosePerk(i),
    r.s.rerolls,
    () => {
      if (r.rerollPerks()) showPerks();
    },
    r.s.tower,
  );
}

function showDeath(): void {
  const r = run;
  if (!r || paused || r.s.phase !== 'dead') return;
  // One revive per run, and none at all in the tower.
  if (r.s.revived || r.s.tower) {
    endRun();
    return;
  }
  screens.showDeath(
    { floor: r.s.floor, canRevive: true, gems: save.gems, simulated: platform.simulated, ads: platform.adsAvailable },
    {
      gems: () => {
        if (save.gems < REVIVE_GEM_COST) return;
        save.gems -= REVIVE_GEM_COST;
        writeSave(save);
        screens.close();
        r.revive();
      },
      ad: async () => {
        const token = runToken;
        const earned = await watchAd(AD_PLACEMENTS.revive);
        if (token !== runToken) return;
        screens.close();
        if (earned) r.revive();
        else showDeath();
      },
      end: endRun,
    },
  );
}

function endRun(): void {
  const r = run;
  if (!r) return;
  if (r.s.tower) {
    endTowerRun(r);
    return;
  }
  r.end();
  const dev = devRun;
  const pay = dev ? { coins: 0, gems: 0, lost: 0 } : r.payout();
  const newBest = !dev && r.s.floor > save.bestFloor;
  let out = { xp: 0, level: levelInfo(save.xp).level, levelsGained: 0, chests: 0, passTiersGained: 0 };
  if (!dev) {
    save.bestFloor = Math.max(save.bestFloor, r.s.floor);
    out = settleRun(save, { coins: pay.coins, gems: pay.gems, floor: r.s.floor, bossKills: r.s.stats.bossKills }, now());
    writeSave(save);
  }
  runToken++;
  screens.showResults(
    {
      floor: r.s.floor,
      best: save.bestFloor,
      newBest,
      damage: r.s.stats.damage,
      kills: r.s.stats.kills,
      maxCombo: r.s.stats.maxCombo,
      maxHit: r.s.stats.maxHit,
      turns: r.s.stats.turns,
      coins: pay.coins,
      gems: pay.gems,
      lost: pay.lost,
      xp: out.xp,
      level: out.level,
      levelsGained: out.levelsGained,
      chests: out.chests,
      passTiers: out.passTiersGained,
      note: dev ? 'Developer mode: nothing from this run was kept.' : undefined,
      canSpend:
        freePoints(save) > 0 ||
        shopHasOffer(save, 'forge') ||
        shopHasOffer(save, 'tavern') ||
        heldChests(save) > 0 ||
        claimableCount(save.pass) > 0,
    },
    startRun,
    showTitle,
  );
}

// ---------------------------------------------------------- settings and pause

/** `back` is where the Back button goes; mid-run that is the pause menu, and progress cannot be reset. */
function openSettings(back: () => void, inRun: boolean): void {
  showSettings(screens, {
    settings: save.settings,
    devAllowed: DEV_ALLOWED,
    canVibrate: typeof navigator.vibrate === 'function',
    changed: () => {
      applySettings();
      writeSave(save);
    },
    reset: inRun
      ? null
      : () => {
          resetProgress(save, now());
          writeSave(save);
          showTitle();
        },
    back,
  });
}

/** Pausing is possible whenever the player is in the dungeon and no other screen is up. */
function canPause(): boolean {
  const p = run?.s.phase;
  return !!run && !paused && !screens.isOpen && (p === 'aim' || p === 'firing' || p === 'resolve' || p === 'perk');
}

function pauseRun(): void {
  if (!canPause()) return;
  paused = true;
  openPauseMenu();
}

function openPauseMenu(): void {
  const r = run;
  if (!r) return;
  showPause(screens, { floor: r.s.floor, tower: r.s.tower }, { resume: resumeRun, settings: () => openSettings(openPauseMenu, true), leave: confirmLeave });
}

function resumeRun(): void {
  paused = false;
  screens.close();
  // Paused between clearing a floor and the cards appearing: show them now.
  if (run?.s.phase === 'perk') showPerks();
}

function confirmLeave(): void {
  const r = run;
  if (!r) return;
  const pay = r.payout();
  showLeaveRun(
    screens,
    { tower: r.s.tower, dev: devRun, coins: pay.coins, lost: pay.lost, xp: xpForRun(r.s.floor, r.s.stats.bossKills) },
    { leave: leaveRun, stay: openPauseMenu },
  );
}

/**
 * Leave from the pause menu: the run ends where it stands. A dungeon run pays
 * what a death here would (banked coins, a share of the rest, XP); a tower run
 * keeps its XP but is not sent to the leaderboard, since only finished climbs count.
 */
function leaveRun(): void {
  const r = run;
  if (!r) return;
  if (!devRun) {
    const bossKills = r.s.stats.bossKills;
    if (r.s.tower) {
      settleRun(save, { coins: 0, gems: 0, floor: r.s.floor, bossKills, chests: 0 }, now());
    } else {
      const pay = r.payout();
      save.bestFloor = Math.max(save.bestFloor, r.s.floor);
      settleRun(save, { coins: pay.coins, gems: pay.gems, floor: r.s.floor, bossKills }, now());
    }
    writeSave(save);
  }
  showTitle();
}

// Leaving the app or switching tabs mid-run pauses it.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') pauseRun();
});

// Escape or P toggles the pause menu on a keyboard.
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' && e.key.toLowerCase() !== 'p') return;
  if (e.target instanceof HTMLInputElement) return;
  if (screens.isShowing('pause')) resumeRun();
  else pauseRun();
});

function onPhase(phase: Phase): void {
  const r = run;
  if (!r) return;
  if (phase === 'perk') {
    // Let the last shatter play out before the cards cover it.
    if (r.s.perkReason === 'starter') showPerks();
    else later(r.s.perkReason === 'boss' ? 1500 : 650, showPerks);
  } else if (phase === 'dead') {
    later(900, showDeath);
  }
}

/** One frame of game time: simulate, feed the effects, draw. */
function tick(dt: number): void {
  const r = run;
  if (r && !paused) {
    // Long turns speed themselves up so nobody waits on the last few orbs.
    const t = r.s.phase === 'firing' ? r.s.turnTime : 0;
    const speed = Math.min(8, save.settings.speed * (t > 14 ? 3 : t > 7 ? 2 : 1));
    effectiveSpeed = speed;
    const frozen = fx.hitStop > 0 && speed === 1;
    r.update(frozen ? 0 : dt * speed);
    fx.handle(r.drainEvents(), r, sfx, renderer.bump, 1 / Math.sqrt(speed));
    if (r.s.phase !== lastPhase) {
      lastPhase = r.s.phase;
      onPhase(r.s.phase);
    }
  }
  if (!paused) fx.update(dt);
  renderer.draw(r, fx, aim, dt);
  screens.setHud({
    inRun: !!r && r.s.phase !== 'over',
    speed: save.settings.speed,
    effective: r ? effectiveSpeed : save.settings.speed,
    canRecall: !!r && r.s.phase === 'firing' && r.s.turnTime > 1.5 && !screens.isOpen,
    corner: r ? (canPause() ? 'pause' : null) : screens.isShowing('title') ? 'settings' : null,
    energy: energyText(save, now()),
  });
}

let last = performance.now();
let slowFrames = 0;

function frame(now: number): void {
  const raw = (now - last) / 1000;
  const dt = Math.min(0.05, Math.max(0, raw));
  last = now;
  // Bloom is the costliest pass. Drop it on devices that cannot hold ~40fps.
  if (renderer.bloom && document.visibilityState === 'visible' && raw < 0.25) {
    slowFrames = raw > 0.026 ? slowFrames + 1 : Math.max(0, slowFrames - 2);
    if (slowFrames > 120) {
      slowDevice = true;
      renderer.bloom = false;
    }
  }
  tick(dt);
  requestAnimationFrame(frame);
}

showTitle();
requestAnimationFrame(frame);

if (import.meta.env.DEV) {
  // Console handle for poking at a live run during development.
  Object.assign(window, {
    __sd: {
      get run() {
        return run;
      },
      save,
      fx,
      renderer,
      startRun,
      tick,
    },
  });
}
