import { SPEEDS, type Settings } from '../save';
import { fmt } from '../util';
import { header } from './hub';
import { el, type Screens } from './screens';

export interface SettingsCtx {
  settings: Settings;
  /** Developer mode can be switched on in this build (development builds only). */
  devAllowed: boolean;
  /** The device can vibrate (iPhones cannot, from a web page). */
  canVibrate: boolean;
  /** Save and apply the settings after any change. */
  changed(): void;
  /** Erase all progress. Null where it is not offered (mid-run). */
  reset: (() => void) | null;
  back(): void;
}

/** One on/off row. */
function toggle(label: string, desc: string, get: () => boolean, set: (on: boolean) => void, after: () => void): HTMLElement {
  const row = el('div', 'set');
  const body = el('span', 'body');
  body.append(el('b', '', label));
  if (desc) body.append(el('small', '', desc));
  const sw = el('button', 'switch');
  sw.setAttribute('role', 'switch');
  sw.setAttribute('aria-label', label);
  const paint = (): void => sw.setAttribute('aria-checked', String(get()));
  sw.onclick = () => {
    set(!get());
    paint();
    after();
  };
  paint();
  row.append(body, sw);
  return row;
}

export function showSettings(screens: Screens, ctx: SettingsCtx): void {
  const d = screens.open('meta settings');
  const s = ctx.settings;
  const list = el('div', 'list');

  list.append(el('h3', 'sec', 'Game'));
  const speedRow = el('div', 'set');
  const speedBody = el('span', 'body');
  speedBody.append(el('b', '', 'Game speed'), el('small', '', 'Long turns still speed up on their own.'));
  const seg = el('div', 'seg');
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', 'Game speed');
  const paintSpeed = (): void => {
    for (const b of seg.children) b.setAttribute('aria-checked', String((b as HTMLElement).dataset.speed === String(s.speed)));
  };
  for (const v of SPEEDS) {
    const b = el('button', '', `${v}×`);
    b.setAttribute('role', 'radio');
    b.dataset.speed = String(v);
    b.onclick = () => {
      s.speed = v;
      paintSpeed();
      ctx.changed();
    };
    seg.append(b);
  }
  paintSpeed();
  speedRow.append(speedBody, seg);
  list.append(speedRow);

  list.append(el('h3', 'sec', 'Sound and feel'));
  list.append(
    toggle('Sound', '', () => !s.muted, (on) => (s.muted = !on), ctx.changed),
    toggle('Screen shake', 'The board jolts on big hits and when you take damage.', () => s.shake, (on) => (s.shake = on), ctx.changed),
  );
  if (ctx.canVibrate) {
    list.append(toggle('Vibration', 'A short buzz when you are hit.', () => s.haptics, (on) => (s.haptics = on), ctx.changed));
  }
  list.append(
    toggle('Glow effects', 'Turn off if the game runs slowly.', () => s.glow, (on) => (s.glow = on), ctx.changed),
  );

  if (ctx.devAllowed) {
    list.append(el('h3', 'sec', 'Developer'));
    list.append(
      toggle(
        'Max upgrades',
        'Runs use a fully upgraded hero and cost no energy. Your save is not changed and those runs bank nothing. Only in development builds.',
        () => s.dev,
        (on) => (s.dev = on),
        ctx.changed,
      ),
    );
  }

  if (ctx.reset) {
    const reset = ctx.reset;
    list.append(el('h3', 'sec', 'Progress'));
    const btn = el('button', 'btn danger small', 'Reset all progress');
    let armed = false;
    let timer = 0;
    btn.onclick = () => {
      if (!armed) {
        armed = true;
        btn.textContent = 'Tap again to erase everything';
        btn.classList.add('armed');
        timer = window.setTimeout(() => {
          armed = false;
          btn.textContent = 'Reset all progress';
          btn.classList.remove('armed');
        }, 4000);
        return;
      }
      window.clearTimeout(timer);
      reset();
    };
    list.append(
      el('p', 'fine', 'Erases coins, gems, upgrades, talents, orbs, chests, the season pass and your records. Settings and your leaderboard name are kept. This cannot be undone.'),
      btn,
    );
  }

  d.append(header('Settings', el('span', 'slot'), ctx.back), list);
}

export interface PauseInfo {
  floor: number;
  tower: boolean;
}

/** The pause menu. The run is frozen underneath. */
export function showPause(screens: Screens, info: PauseInfo, on: { resume(): void; settings(): void; leave(): void }): void {
  const d = screens.open('pause');
  const resume = el('button', 'btn primary', 'Resume');
  resume.onclick = on.resume;
  const settings = el('button', 'btn', 'Settings');
  settings.onclick = on.settings;
  const leave = el('button', 'btn ghost', 'Leave run');
  leave.onclick = on.leave;
  d.append(el('h2', '', 'Paused'), el('p', 'sub', `${info.tower ? 'Weekly Tower' : 'Dungeon'}  ·  floor ${info.floor}`), resume, settings, leave);
}

export interface LeaveInfo {
  tower: boolean;
  /** Developer-mode run: nothing is kept. */
  dev: boolean;
  /** Coins kept if the run ends now, and unbanked coins that would be lost. */
  coins: number;
  lost: number;
  xp: number;
}

/** Confirm leaving a run from the pause menu, spelling out what is kept. */
export function showLeaveRun(screens: Screens, info: LeaveInfo, on: { leave(): void; stay(): void }): void {
  const d = screens.open('leave');
  let text: string;
  if (info.dev) {
    text = 'Developer mode: nothing from this run is kept either way.';
  } else if (info.tower) {
    text = `This climb will not count for the leaderboard. You keep the ${fmt(info.xp)} XP it has earned.`;
  } else {
    text = `You keep what you would if you fell here: ${fmt(info.coins)} coins and ${fmt(info.xp)} XP.`;
    if (info.lost > 0) text += ` The ${fmt(info.lost)} coins not yet banked by a boss are lost.`;
  }
  const stay = el('button', 'btn primary', 'Keep playing');
  stay.onclick = on.stay;
  const leave = el('button', 'btn danger', 'Leave run');
  leave.onclick = on.leave;
  d.append(el('h2', '', 'Leave this run?'), el('p', 'note', text), stay, leave);
}
