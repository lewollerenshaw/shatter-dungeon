import { PERK_BY_ID, type PerkDef } from '../sim/perks';
import { REVIVE_GEM_COST, type PerkReason } from '../sim/types';
import { fmt } from '../util';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

const GLYPH: Record<PerkDef['icon'], string> = {
  none: '○',
  fire: '▲',
  ice: '◆',
  lightning: 'ϟ',
  poison: '●',
  power: '✦',
  crit: '✸',
  life: '♥',
  gold: '◆',
  orb: '○',
};

export interface ResultsData {
  floor: number;
  best: number;
  newBest: boolean;
  damage: number;
  kills: number;
  maxCombo: number;
  maxHit: number;
  turns: number;
  coins: number;
  gems: number;
  lost: number;
}

export interface HudState {
  inRun: boolean;
  /** The player's chosen speed setting. */
  speed: number;
  /** Speed actually in effect (long turns accelerate on their own). */
  effective: number;
  canRecall: boolean;
  muted: boolean;
}

/** DOM overlays: title, perk choice, death, results, and the in-run buttons. */
export class Screens {
  private layer: HTMLElement | null = null;
  private speedBtn: HTMLButtonElement;
  private recallBtn: HTMLButtonElement;
  private muteBtn: HTMLButtonElement;

  constructor(
    private root: HTMLElement,
    handlers: { onSpeed(): void; onRecall(): void; onMute(): void; onClick(): void },
  ) {
    this.muteBtn = el('button', 'hud-btn mute');
    this.muteBtn.setAttribute('aria-label', 'Toggle sound');
    this.muteBtn.onclick = () => handlers.onMute();
    this.speedBtn = el('button', 'hud-btn speed');
    this.speedBtn.setAttribute('aria-label', 'Game speed');
    this.speedBtn.onclick = () => handlers.onSpeed();
    this.recallBtn = el('button', 'hud-btn recall', 'Recall orbs');
    this.recallBtn.onclick = () => handlers.onRecall();
    root.append(this.muteBtn, this.speedBtn, this.recallBtn);
    root.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) handlers.onClick();
    });
  }

  get isOpen(): boolean {
    return this.layer !== null;
  }

  setHud(s: HudState): void {
    this.muteBtn.textContent = '♪';
    this.muteBtn.setAttribute('aria-pressed', String(!s.muted));
    this.muteBtn.title = s.muted ? 'Sound off' : 'Sound on';
    this.muteBtn.classList.toggle('off', s.muted);
    this.speedBtn.hidden = !s.inRun;
    this.speedBtn.textContent = `${s.effective}×`;
    this.speedBtn.classList.toggle('hot', s.speed > 1);
    this.speedBtn.classList.toggle('auto', s.effective > s.speed);
    this.recallBtn.hidden = !s.canRecall;
  }

  close(): void {
    this.layer?.remove();
    this.layer = null;
  }

  private open(cls: string): HTMLElement {
    this.close();
    const d = el('div', `screen ${cls}`);
    this.root.appendChild(d);
    this.layer = d;
    return d;
  }

  showTitle(info: { bestFloor: number; coins: number; gems: number; runs: number }, onPlay: () => void): void {
    const d = this.open('title');
    const logo = el('h1', 'logo');
    logo.append(el('span', 'l1', 'SHATTER'), el('span', 'l2', 'DUNGEON'));
    const wallet = el('div', 'wallet');
    wallet.append(
      this.stat('Best floor', info.bestFloor > 0 ? String(info.bestFloor) : '–'),
      this.stat('Coins', fmt(info.coins), 'gold'),
      this.stat('Gems', fmt(info.gems), 'gem'),
    );
    const play = el('button', 'btn primary', info.runs > 0 ? 'Descend again' : 'Enter the dungeon');
    play.onclick = onPlay;
    d.append(
      logo,
      el('p', 'tag', 'Bounce. Chain. Shatter.'),
      wallet,
      play,
      el('p', 'hint', 'Drag to aim, release to fire. Clear a floor to pick an upgrade. A boss waits every 10 floors.'),
    );
  }

  private stat(label: string, value: string, cls = ''): HTMLElement {
    const s = el('div', `stat ${cls}`);
    s.append(el('b', '', value), el('span', '', label));
    return s;
  }

  showPerks(
    choices: string[],
    reason: PerkReason,
    floor: number,
    owned: Record<string, number>,
    onPick: (index: number) => void,
  ): void {
    const d = this.open('perks');
    const title = reason === 'starter' ? 'Choose your first orb' : reason === 'boss' ? 'Boss defeated' : `Floor ${floor} cleared`;
    const sub = reason === 'starter' ? 'It joins your three plain orbs.' : reason === 'boss' ? 'Loot banked. Claim a rare reward.' : 'Choose an upgrade.';
    d.append(el('h2', reason === 'boss' ? 'gold' : '', title), el('p', 'sub', sub));
    let picked = false;
    choices.forEach((id, i) => {
      const p = PERK_BY_ID[id];
      const card = el('button', `card ${p.rarity} icon-${p.icon}`);
      card.style.animationDelay = `${i * 70}ms`;
      const body = el('span', 'body');
      const head = el('span', 'head');
      head.append(el('b', '', p.name), el('i', 'rarity', p.rarity));
      body.append(head, el('small', '', p.desc));
      const have = owned[id] ?? 0;
      card.append(el('span', 'chip', GLYPH[p.icon]), body);
      if (have > 0) card.append(el('span', 'lvl', `Lv ${have + 1}`));
      card.onclick = () => {
        if (picked) return;
        picked = true;
        card.classList.add('picked');
        setTimeout(() => {
          this.close();
          onPick(i);
        }, 160);
      };
      d.append(card);
    });
  }

  showDeath(
    info: { floor: number; canRevive: boolean; gems: number; simulated: boolean },
    on: { gems(): void; ad(): void; end(): void },
  ): void {
    const d = this.open('death');
    d.append(el('h2', 'bad', 'Shattered'), el('p', 'sub', `You fell on floor ${info.floor}.`));
    if (info.canRevive) {
      const g = el('button', 'btn primary', `Revive for ${REVIVE_GEM_COST} gems`);
      g.disabled = info.gems < REVIVE_GEM_COST;
      g.onclick = on.gems;
      const a = el('button', 'btn', 'Revive by watching an ad');
      a.onclick = on.ad;
      d.append(
        el('p', 'note', 'Once per run: clear the board and get back up at half health.'),
        g,
        el('p', 'have', `You have ${fmt(info.gems)} gems`),
        a,
      );
    }
    const e = el('button', 'btn ghost', 'End run');
    e.onclick = on.end;
    d.append(e);
    if (info.canRevive && info.simulated) d.append(el('p', 'fine', 'Ads and purchases are simulated in this build. No money is spent.'));
  }

  showAd(ms: number): void {
    const d = this.open('ad');
    const barEl = el('div', 'adbar');
    const fill = el('i');
    fill.style.animationDuration = `${ms}ms`;
    barEl.append(fill);
    d.append(el('h2', '', 'Simulated ad'), el('p', 'sub', 'A rewarded video would play here.'), barEl);
  }

  showResults(r: ResultsData, onAgain: () => void, onTitle: () => void): void {
    const d = this.open('results');
    d.append(el('h2', '', 'Run over'), el('p', 'sub', r.newBest ? `New best: floor ${r.floor}` : `Floor ${r.floor}  ·  best ${r.best}`));
    const table = el('div', 'table');
    const row = (k: string, v: string, cls = ''): void => {
      const line = el('div', `row ${cls}`);
      line.append(el('span', '', k), el('b', '', v));
      table.append(line);
    };
    row('Damage dealt', fmt(r.damage));
    row('Blocks shattered', fmt(r.kills));
    row('Biggest combo', fmt(r.maxCombo));
    row('Biggest hit', fmt(r.maxHit));
    row('Turns', String(r.turns));
    row('Coins kept', `+${fmt(r.coins)}`, 'gold');
    if (r.lost > 0) row('Coins lost (not banked)', `-${fmt(r.lost)}`, 'dim');
    row('Gems earned', `+${fmt(r.gems)}`, 'gem');
    const again = el('button', 'btn primary', 'Descend again');
    again.onclick = onAgain;
    const title = el('button', 'btn ghost', 'Back to title');
    title.onclick = onTitle;
    d.append(table, el('p', 'fine', 'Beat a boss to bank everything you are carrying. Otherwise you keep a quarter.'), again, title);
  }
}
