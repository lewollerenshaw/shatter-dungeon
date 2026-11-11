import { PERK_BY_ID, type PerkDef } from '../sim/perks';
import { REVIVE_GEM_COST, type PerkReason } from '../sim/types';
import { fmt } from '../util';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

export const GLYPH: Record<PerkDef['icon'], string> = {
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
  xp: number;
  level: number;
  /** Levels gained by this run (each is a talent point). */
  levelsGained: number;
  /** Something is waiting on the title screen: an affordable upgrade, a talent point, a chest or a pass reward. */
  canSpend: boolean;
  /** Wooden Chests earned from bosses. */
  chests: number;
  /** Season pass tiers unlocked by this run. */
  passTiers: number;
}

export interface TitleInfo {
  bestFloor: number;
  coins: number;
  gems: number;
  runs: number;
  level: number;
  /** Unspent talent points. */
  points: number;
  forgeOffer: boolean;
  tavernOffer: boolean;
  /** Orbs can be merged. */
  orbsOffer: boolean;
  /** Unopened chests. */
  chests: number;
  /** Pass rewards waiting to be claimed. */
  passRewards: number;
  /** Live energy readout. */
  energy: string;
  /** Time left in this week's tower, e.g. "3d 4h". */
  towerLeft: string;
}

export interface HudState {
  inRun: boolean;
  /** The player's chosen speed setting. */
  speed: number;
  /** Speed actually in effect (long turns accelerate on their own). */
  effective: number;
  canRecall: boolean;
  muted: boolean;
  /** Text for any live energy readout on screen. */
  energy: string;
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
    const live = this.layer?.querySelector('[data-energy]');
    if (live && live.textContent !== s.energy) live.textContent = s.energy;
  }

  /** True while `layer` is still the screen being shown (async flows check before redrawing). */
  isCurrent(layer: HTMLElement): boolean {
    return this.layer === layer;
  }

  close(): void {
    this.layer?.remove();
    this.layer = null;
  }

  open(cls: string): HTMLElement {
    this.close();
    const d = el('div', `screen ${cls}`);
    this.root.appendChild(d);
    this.layer = d;
    return d;
  }

  showTitle(
    info: TitleInfo,
    on: {
      play(): void;
      tower(): void;
      forge(): void;
      tavern(): void;
      talents(): void;
      orbs(): void;
      store(): void;
      pass(): void;
    },
  ): void {
    const d = this.open('title');
    const logo = el('h1', 'logo');
    logo.append(el('span', 'l1', 'SHATTER'), el('span', 'l2', 'DUNGEON'));
    const wallet = el('div', 'wallet');
    wallet.append(
      this.stat('Level', String(info.level)),
      this.stat('Best floor', info.bestFloor > 0 ? String(info.bestFloor) : '–'),
      this.stat('Coins', fmt(info.coins), 'gold'),
      this.stat('Gems', fmt(info.gems), 'gem'),
    );
    const play = el('button', 'btn primary', info.runs > 0 ? 'Descend again' : 'Enter the dungeon');
    play.onclick = on.play;
    const tower = el('button', 'btn towerbtn');
    tower.append(el('b', '', 'Weekly Tower'), el('small', '', `Leaderboard  ·  ${info.towerLeft} left`));
    tower.onclick = on.tower;
    const energy = el('p', 'energy', info.energy);
    energy.dataset.energy = '';
    const tile = (row: HTMLElement, cls: string, glyph: string, name: string, sub: string, badge: string, go: () => void): void => {
      const b = el('button', `tile ${cls}`);
      b.append(el('span', 'glyph', glyph), el('b', '', name), el('small', '', sub));
      if (badge) b.append(el('i', 'badge', badge));
      b.onclick = go;
      row.append(b);
    };
    const upgrades = el('div', 'hub');
    tile(upgrades, 'forge', '✦', 'Forge', 'Orb upgrades', info.forgeOffer ? '!' : '', on.forge);
    tile(upgrades, 'tavern', '♥', 'Tavern', 'Hero upgrades', info.tavernOffer ? '!' : '', on.tavern);
    tile(upgrades, 'talents', '✸', 'Talents', 'Skill tree', info.points > 0 ? String(info.points) : '', on.talents);
    const shop = el('div', 'hub');
    tile(shop, 'orbs', '○', 'Orbs', 'Collect, merge', info.orbsOffer ? '!' : '', on.orbs);
    tile(shop, 'store', '▣', 'Store', 'Chests, gems', info.chests > 0 ? String(info.chests) : '', on.store);
    tile(shop, 'pass', '★', 'Pass', 'Season rewards', info.passRewards > 0 ? String(info.passRewards) : '', on.pass);
    d.append(logo, el('p', 'tag', 'Bounce. Chain. Shatter.'), wallet, play, tower, energy, upgrades, shop);
    if (info.runs === 0) {
      d.append(el('p', 'hint', 'Drag to aim, release to fire. Beat a boss to bank your coins, then spend them here.'));
    }
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
    rerolls = 0,
    onReroll: (() => void) | null = null,
    tower = false,
  ): void {
    const d = this.open('perks');
    const title = reason === 'starter' ? 'Choose your first orb' : reason === 'boss' ? 'Boss defeated' : `Floor ${floor} cleared`;
    const sub = reason === 'starter' ? 'It joins your three plain orbs.' : reason === 'boss' ? (tower ? 'Claim a rare reward.' : 'Loot banked. Claim a rare reward.') : 'Choose an upgrade.';
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
    if (onReroll && rerolls > 0 && reason !== 'starter') {
      const again = el('button', 'btn small', `Reroll  ·  ${rerolls} left`);
      again.onclick = () => {
        if (!picked) onReroll();
      };
      d.append(again);
    }
  }

  showDeath(
    info: { floor: number; canRevive: boolean; gems: number; simulated: boolean; ads: boolean },
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
      );
      if (info.ads) d.append(a);
    }
    const e = el('button', 'btn ghost', 'End run');
    e.onclick = on.end;
    d.append(e);
    if (info.canRevive && info.simulated) d.append(el('p', 'fine', 'Ads and purchases are simulated in this build. No money is spent.'));
  }

  /** A plain holding screen while something outside the game (a real ad) loads. */
  showWait(text: string): void {
    const d = this.open('ad');
    d.append(el('p', 'sub', text));
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
    row('Experience', `+${fmt(r.xp)} XP`);
    if (r.chests > 0) row('Wooden Chests', `+${r.chests}`, 'gold');
    if (r.passTiers > 0) row('Season pass', `+${r.passTiers} ${r.passTiers === 1 ? 'tier' : 'tiers'}`);
    d.append(table);
    if (r.levelsGained > 0) {
      const points = r.levelsGained === 1 ? '1 talent point' : `${r.levelsGained} talent points`;
      d.append(el('p', 'levelup', `Level ${r.level} reached  ·  ${points} to spend`));
    }
    const again = el('button', 'btn primary', 'Descend again');
    again.onclick = onAgain;
    const title = el('button', r.canSpend ? 'btn' : 'btn ghost', r.canSpend ? 'Spend your loot' : 'Back to title');
    title.onclick = onTitle;
    d.append(el('p', 'fine', 'Beat a boss to bank everything you are carrying. Otherwise you keep only a share.'), again, title);
  }
}
