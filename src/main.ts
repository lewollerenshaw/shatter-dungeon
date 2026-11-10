import './style.css';
import { AimInput } from './input';
import { AD_PLACEMENTS, type Platform } from './platform/platform';
import { SIMULATED_AD_MS, SimulatedPlatform } from './platform/simulated';
import { loadSave, writeSave } from './save';
import {
  buyUpgrade,
  freePoints,
  learnTalent,
  levelInfo,
  resetTalents,
  shopHasOffer,
  xpForRun,
  type ShopId,
} from './sim/meta';
import { Run } from './sim/run';
import { H, REVIVE_GEM_COST, W, type Phase } from './sim/types';
import { Sfx } from './view/audio';
import { Fx } from './view/fx';
import { showShop, showTalents } from './view/hub';
import { Renderer } from './view/renderer';
import { Screens } from './view/screens';

const stage = document.getElementById('stage') as HTMLDivElement;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLDivElement;

const platform: Platform = new SimulatedPlatform();
const save = loadSave();
const sfx = new Sfx();
sfx.muted = save.settings.muted;
const fx = new Fx();
const renderer = new Renderer(canvas);

let run: Run | null = null;
/** Bumped whenever a run starts or ends, so stale timers can tell they are stale. */
let runToken = 0;
let lastPhase: Phase | null = null;
let effectiveSpeed = 1;

const SPEEDS = [1, 2, 4];

const screens = new Screens(ui, {
  onSpeed: () => {
    save.settings.speed = SPEEDS[(SPEEDS.indexOf(save.settings.speed) + 1) % SPEEDS.length];
    writeSave(save);
  },
  onRecall: () => run?.recall(),
  onMute: () => {
    save.settings.muted = !save.settings.muted;
    sfx.muted = save.settings.muted;
    writeSave(save);
  },
  onClick: () => sfx.click(),
});

const aim = new AimInput(
  canvas,
  () => ({ canAim: !!run && run.s.phase === 'aim' && !screens.isOpen, launchX: run ? run.s.launchX : W / 2 }),
  (angle) => run?.fire(angle),
);

window.addEventListener('pointerdown', () => sfx.unlock(), { capture: true });

function layout(): void {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const s = Math.min(vw / W, vh / H);
  stage.style.transform = `translate(${((vw - W * s) / 2).toFixed(1)}px, ${((vh - H * s) / 2).toFixed(1)}px) scale(${s.toFixed(4)})`;
  renderer.resize(s);
}
window.addEventListener('resize', layout);
layout();

/** Run `fn` after `ms`, unless the run has changed in the meantime. */
function later(ms: number, fn: () => void): void {
  const token = runToken;
  setTimeout(() => {
    if (token === runToken) fn();
  }, ms);
}

function showTitle(): void {
  runToken++;
  run = null;
  lastPhase = null;
  fx.reset();
  renderer.reset();
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
    },
    { play: startRun, forge: () => openShop('forge'), tavern: () => openShop('tavern'), talents: openTalents },
  );
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
  runToken++;
  fx.reset();
  renderer.reset();
  screens.close();
  run = new Run((Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0, save);
  lastPhase = null;
  save.runs++;
  writeSave(save);
}

function showPerks(): void {
  const r = run;
  if (!r || r.s.phase !== 'perk' || !r.s.perkChoices) return;
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
  );
}

function showDeath(): void {
  const r = run;
  if (!r || r.s.phase !== 'dead') return;
  if (r.s.revived) {
    endRun();
    return;
  }
  screens.showDeath(
    { floor: r.s.floor, canRevive: true, gems: save.gems, simulated: platform.simulated },
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
        screens.showAd(SIMULATED_AD_MS);
        const earned = await platform.showRewardedAd(AD_PLACEMENTS.revive);
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
  r.end();
  const pay = r.payout();
  const newBest = r.s.floor > save.bestFloor;
  save.bestFloor = Math.max(save.bestFloor, r.s.floor);
  save.coins += pay.coins;
  save.gems += pay.gems;
  const xp = xpForRun(r.s.floor, r.s.stats.bossKills);
  const levelBefore = levelInfo(save.xp).level;
  save.xp += xp;
  const level = levelInfo(save.xp).level;
  writeSave(save);
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
      xp,
      level,
      levelsGained: level - levelBefore,
      canSpend: freePoints(save) > 0 || shopHasOffer(save, 'forge') || shopHasOffer(save, 'tavern'),
    },
    startRun,
    showTitle,
  );
}

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
  if (r) {
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
  fx.update(dt);
  renderer.draw(r, fx, aim, dt);
  screens.setHud({
    inRun: !!r && r.s.phase !== 'over',
    speed: save.settings.speed,
    effective: r ? effectiveSpeed : save.settings.speed,
    canRecall: !!r && r.s.phase === 'firing' && r.s.turnTime > 1.5 && !screens.isOpen,
    muted: save.settings.muted,
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
    if (slowFrames > 120) renderer.bloom = false;
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
