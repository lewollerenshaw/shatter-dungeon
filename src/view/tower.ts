import type { Board, BoardRow } from '../net/tower';
import { NAME_MAX, type TowerScore } from '../sim/tower';
import { fmt } from '../util';
import { el, type Screens } from './screens';

/** "3d 4h", "5h 12m" or "12m". */
export function formatLeft(ms: number): string {
  const mins = Math.max(0, Math.ceil(ms / 60_000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const scoreText = (s: TowerScore): string => `Floor ${s.floor}`;

export interface TowerCtx {
  week: number;
  leftMs: number;
  name: string;
  best: TowerScore | null;
  /** Fetch the board (sending any unsent run first). Rejects when the server cannot be reached. */
  board(): Promise<Board>;
  /** Returns the cleaned name that was saved, or null if the name was not usable. */
  rename(name: string): string | null;
  climb(): void;
  back(): void;
}

function boardRow(r: BoardRow): HTMLElement {
  const row = el('div', `lb${r.you ? ' you' : ''}${r.rank <= 3 ? ' podium' : ''}`);
  row.append(
    el('span', 'rank', String(r.rank)),
    el('b', '', r.you ? `${r.name} (you)` : r.name),
    el('span', 'floor', `Floor ${r.floor}`),
    el('small', '', `${fmt(r.kills)} shattered`),
  );
  return row;
}

/** The weekly tower: rules, your name, the leaderboard, and the button to climb. */
export function showTower(screens: Screens, ctx: TowerCtx): void {
  const d = screens.open('meta tower');
  const bar = el('div', 'bar');
  const back = el('button', 'back', '‹ Back');
  back.onclick = ctx.back;
  bar.append(back, el('h2', '', 'Weekly Tower'), el('span', 'pill', `${formatLeft(ctx.leftMs)} left`));

  const who = el('div', 'who');
  let name = ctx.name;
  const showName = (): void => {
    const change = el('button', 'link', 'Change');
    change.onclick = editName;
    const label = el('span', '', 'Climbing as ');
    label.append(el('b', '', name));
    who.replaceChildren(label, change);
  };
  const editName = (): void => {
    const input = el('input', 'name');
    input.value = name;
    input.maxLength = NAME_MAX;
    input.setAttribute('aria-label', 'Leaderboard name');
    input.autocomplete = 'off';
    input.spellcheck = false;
    const save = el('button', 'link', 'Save');
    const commit = (): void => {
      const cleaned = ctx.rename(input.value);
      if (!cleaned) {
        input.classList.add('bad');
        return;
      }
      name = cleaned;
      showName();
      load();
    };
    save.onclick = commit;
    input.onkeydown = (e) => {
      if (e.key === 'Enter') commit();
    };
    who.replaceChildren(input, save);
    input.focus();
  };

  const list = el('div', 'list board');
  const load = (): void => {
    list.replaceChildren(el('p', 'fine', 'Loading the leaderboard…'));
    ctx.board().then(
      (board) => {
        if (!screens.isCurrent(d)) return;
        list.replaceChildren();
        if (board.top.length === 0) {
          list.append(el('p', 'fine', 'Nobody has climbed yet this week. Be the first.'));
          return;
        }
        for (const r of board.top) list.append(boardRow(r));
        if (board.you && !board.top.some((r) => r.you)) {
          list.append(el('p', 'gap', '· · ·'), boardRow(board.you));
        }
        list.append(el('p', 'fine', `${board.total} ${board.total === 1 ? 'climber' : 'climbers'} this week`));
      },
      () => {
        if (!screens.isCurrent(d)) return;
        const retry = el('button', 'link', 'Try again');
        retry.onclick = load;
        list.replaceChildren(
          el('p', 'fine', 'The leaderboard cannot be reached. You can still climb: your best run is kept and sent when it is back.'),
          retry,
        );
      },
    );
  };

  const climb = el('button', 'btn primary', 'Climb  ·  1 energy');
  climb.onclick = ctx.climb;
  d.append(
    bar,
    el('p', 'sub', 'The same tower and the same loadout for everyone. One life, no revives. Your best floor of the week counts.'),
    who,
    el('p', 'mine', ctx.best ? `Your best this week: ${scoreText(ctx.best)}` : 'You have not climbed this week.'),
    list,
    climb,
  );
  showName();
  load();
}

export interface TowerResults {
  floor: number;
  kills: number;
  turns: number;
  xp: number;
  level: number;
  levelsGained: number;
  /** Best of the week including this run. */
  best: TowerScore | null;
  newBest: boolean;
}

/** End of a tower run. Returns a function that updates the leaderboard status line. */
export function showTowerResults(
  screens: Screens,
  r: TowerResults,
  on: { again(): void; board(): void; title(): void },
): (text: string) => void {
  const d = screens.open('results tower');
  const sub = r.newBest ? `Floor ${r.floor}: your best this week` : `Floor ${r.floor}  ·  best this week ${r.best ? r.best.floor : r.floor}`;
  d.append(el('h2', '', 'Tower run over'), el('p', 'sub', sub));
  const table = el('div', 'table');
  const row = (k: string, v: string): void => {
    const line = el('div', 'row');
    line.append(el('span', '', k), el('b', '', v));
    table.append(line);
  };
  row('Blocks shattered', fmt(r.kills));
  row('Turns', String(r.turns));
  row('Experience', `+${fmt(r.xp)} XP`);
  const status = el('p', 'levelup', '');
  d.append(table, status);
  if (r.levelsGained > 0) {
    const points = r.levelsGained === 1 ? '1 talent point' : `${r.levelsGained} talent points`;
    d.append(el('p', 'fine', `Level ${r.level} reached: ${points} to spend.`));
  }
  const again = el('button', 'btn primary', 'Climb again  ·  1 energy');
  again.onclick = on.again;
  const board = el('button', 'btn', 'Leaderboard');
  board.onclick = on.board;
  const title = el('button', 'btn ghost', 'Back to title');
  title.onclick = on.title;
  d.append(el('p', 'fine', 'Tower runs earn experience but no coins.'), again, board, title);
  return (text) => {
    if (screens.isCurrent(d)) status.textContent = text;
  };
}
