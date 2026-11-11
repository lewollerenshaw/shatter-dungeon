import { ENERGY_MAX, ENERGY_REFILL_GEMS, ENERGY_REGEN_MS, energyAt, formatWait } from '../sim/energy';
import {
  CHESTS,
  CHEST_IDS,
  MAX_ORB_LEVEL,
  MERGE_COUNT,
  ORB_TYPES,
  anyMergeable,
  mergeable,
  orbLevel,
  orbPower,
  type ChestDef,
  type ChestId,
  type ChestLoot,
} from '../sim/orbs';
import {
  PASS_TIERS,
  PASS_TIER_XP,
  canClaim,
  claimableCount,
  passReward,
  passTier,
  seasonEndsIn,
  type Reward,
  type Track,
} from '../sim/pass';
import {
  AD_CHESTS_PER_DAY,
  PRODUCTS,
  adChestsLeft,
  canBuyChest,
  canRefillEnergy,
  productAvailable,
  type Wallet,
} from '../sim/store';
import type { Element } from '../sim/types';
import { fmt } from '../util';
import { EL_NAME } from './palette';
import { GLYPH, el, type Screens } from './screens';

const COIN = '◆';
const GEM = '◈';
const SIM_NOTE = 'Purchases and ads are simulated in this build. No money is spent.';

export function rewardLabel(r: Reward): string {
  const parts: string[] = [];
  if (r.coins) parts.push(`${COIN} ${fmt(r.coins)}`);
  if (r.gems) parts.push(`${GEM} ${fmt(r.gems)}`);
  if (r.chest) parts.push(CHESTS[r.chest].name);
  return parts.join(' + ');
}

/** Both balances, for the header of any screen that spends them. */
function purse(w: Wallet): HTMLElement {
  const p = el('span', 'pill purse');
  p.append(el('span', 'gold', `${COIN} ${fmt(w.coins)}`), el('span', 'gem', `${GEM} ${fmt(w.gems)}`));
  return p;
}

function header(title: string, pill: HTMLElement, onBack: () => void): HTMLElement {
  const bar = el('div', 'bar');
  const back = el('button', 'back', '‹ Back');
  back.onclick = onBack;
  bar.append(back, el('h2', '', title), pill);
  return bar;
}

/** One list row: icon, name, a few lines of detail, and an action button. */
function row(cls: string, glyph: string, name: string, tag: string, lines: string[], action: HTMLButtonElement): HTMLElement {
  const r = el('div', `up ${cls}`);
  const body = el('span', 'body');
  const head = el('span', 'head');
  head.append(el('b', '', name));
  if (tag) head.append(el('i', 'lv', tag));
  body.append(head);
  lines.forEach((text, i) => body.append(el('small', i > 0 ? 'next' : '', text)));
  r.append(el('span', 'chip', glyph), body, action);
  return r;
}

function actionButton(label: string, enabled: boolean, cls = ''): HTMLButtonElement {
  const b = el('button', `buy ${cls}`, label);
  b.disabled = !enabled;
  return b;
}

function oddsText(def: ChestDef): string {
  const odds = def.odds.map((p, i) => `Lv ${i + 1} ${Math.round(p * 100)}%`).join(' · ');
  return def.guaranteed > 1 ? `${odds} · one Lv ${def.guaranteed}+` : odds;
}

// --------------------------------------------------------------------- store

export interface StoreCtx {
  wallet: Wallet;
  now(): number;
  price(productId: string): string;
  simulated: boolean;
  /** Run the purchase through the platform and grant it. Resolves false if it did not go through. */
  buyProduct(productId: string): Promise<boolean>;
  /** Pay for a chest and open it. */
  buyChest(id: ChestId): ChestLoot | null;
  /** Open a chest already held. */
  openChest(id: ChestId): ChestLoot | null;
  /** Show a rewarded ad, then open the free chest it earns. */
  adChest(): Promise<ChestLoot | null>;
  back(): void;
}

/** Chests, gem packs and the starter pack. */
export function showStore(screens: Screens, ctx: StoreCtx): void {
  const d = screens.open('meta store');
  const w = ctx.wallet;
  const list = el('div', 'list');
  const pillSlot = el('span', 'slot');
  const reopen = (): void => showStore(screens, ctx);
  const reveal = (loot: ChestLoot | null): void => {
    if (loot) showReveal(screens, loot, reopen);
    else reopen();
  };

  const product = (id: string, cls: string, glyph: string): void => {
    const def = PRODUCTS.find((p) => p.id === id);
    if (!def || !productAvailable(w, id)) return;
    const btn = actionButton(ctx.price(id) || 'Buy', true, 'cash');
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = '…';
      await ctx.buyProduct(id);
      if (screens.isCurrent(d)) render();
    };
    list.append(row(cls, glyph, def.name, '', [def.desc], btn));
  };

  const render = (): void => {
    pillSlot.replaceChildren(purse(w));
    list.replaceChildren();

    if (productAvailable(w, 'starter_pack')) {
      list.append(el('h3', 'sec', 'Welcome offer'));
      product('starter_pack', 'offer icon-gold', '★');
    }

    if (CHEST_IDS.some((id) => w.chests[id] > 0)) {
      list.append(el('h3', 'sec', 'Your chests'));
      for (const id of CHEST_IDS) {
        const n = w.chests[id];
        if (n <= 0) continue;
        const open = actionButton('Open', true);
        open.onclick = () => reveal(ctx.openChest(id));
        list.append(row(`chest c-${id}`, '▣', CHESTS[id].name, `×${n}`, [`${CHESTS[id].orbs} orbs inside`], open));
      }
    }

    list.append(el('h3', 'sec', 'Chests'));
    const left = adChestsLeft(w, ctx.now());
    const watch = actionButton('Watch ad', left > 0);
    watch.onclick = async () => reveal(await ctx.adChest());
    list.append(row('chest c-wood', '▣', 'Free Chest', '', [`A Wooden Chest for watching an ad`, `${left} of ${AD_CHESTS_PER_DAY} left today`], watch));
    for (const id of CHEST_IDS) {
      const def = CHESTS[id];
      const label = def.price.gems ? `${GEM} ${fmt(def.price.gems)}` : `${COIN} ${fmt(def.price.coins ?? 0)}`;
      const buy = actionButton(label, canBuyChest(w, id), def.price.gems ? 'gems' : '');
      buy.onclick = () => reveal(ctx.buyChest(id));
      list.append(row(`chest c-${id}`, '▣', def.name, '', [`${def.orbs} orbs and coins`, oddsText(def)], buy));
    }

    list.append(el('h3', 'sec', 'Gems'));
    for (const p of PRODUCTS) if (p.kind === 'gems') product(p.id, 'icon-gem', GEM);
    if (ctx.simulated) list.append(el('p', 'fine', SIM_NOTE));
  };

  d.append(header('Store', pillSlot, ctx.back), list);
  render();
}

/** What came out of a chest. */
export function showReveal(screens: Screens, loot: ChestLoot, onDone: () => void): void {
  const d = screens.open('reveal');
  const grid = el('div', 'loot');
  loot.orbs.forEach((o, i) => {
    const orb = el('div', `drop icon-${o.element}${o.level >= 3 ? ' rare' : ''}`);
    orb.style.animationDelay = `${150 + i * 90}ms`;
    orb.append(el('span', 'chip', GLYPH[o.element]), el('b', '', `Lv ${o.level}`), el('small', '', EL_NAME[o.element]));
    grid.append(orb);
  });
  const done = el('button', 'btn primary', 'Collect');
  done.onclick = onDone;
  d.append(el('h2', 'gold', CHESTS[loot.chest].name), grid, el('p', 'coins', `+ ${COIN} ${fmt(loot.coins)} coins`), done);
}

// ---------------------------------------------------------------------- orbs

/** The orb collection, and merging. */
export function showOrbs(
  screens: Screens,
  w: Wallet,
  on: { merge(element: Element): number; mergeAll(): number; back(): void },
): void {
  const d = screens.open('meta orbs');
  const list = el('div', 'list');
  const all = el('button', 'btn small', 'Merge all');

  const render = (): void => {
    list.replaceChildren();
    for (const element of ORB_TYPES) {
      const level = orbLevel(w.inv, element);
      const from = mergeable(w.inv, element);
      const held = w.inv[element]
        .map((n, i) => (n > 0 ? `Lv ${i + 1} ×${n}` : ''))
        .filter(Boolean)
        .join(' · ');
      const power = level > 1 ? `+${Math.round((orbPower(level) - 1) * 100)}% hit damage` : 'No bonus yet';
      const merge = actionButton(from > 0 ? `Merge to Lv ${from + 1}` : level >= MAX_ORB_LEVEL ? 'MAX' : 'Merge', from > 0);
      merge.onclick = () => {
        if (on.merge(element) > 0) render();
      };
      list.append(row(`icon-${element}`, GLYPH[element], `${EL_NAME[element]} Orb`, `Lv ${level}/${MAX_ORB_LEVEL}`, [power, `Holding ${held}`], merge));
    }
    all.disabled = !anyMergeable(w.inv);
  };

  all.onclick = () => {
    if (on.mergeAll() > 0) render();
  };
  d.append(
    header('Orbs', el('span', 'slot'), on.back),
    el('p', 'sub', `Merge ${MERGE_COUNT} orbs of a level into one of the next. Your best orb of each kind sets its hit damage in every run.`),
    list,
    all,
    el('p', 'fine', 'Orbs come from chests. Every boss you beat drops a Wooden Chest.'),
  );
  render();
}

// ---------------------------------------------------------------------- pass

export interface PassCtx {
  wallet: Wallet;
  now(): number;
  price(productId: string): string;
  simulated: boolean;
  claim(track: Track, tier: number): Reward | null;
  claimAll(): Reward[];
  buyPremium(): Promise<boolean>;
  back(): void;
}

export function showPass(screens: Screens, ctx: PassCtx): void {
  const d = screens.open('meta pass');
  const w = ctx.wallet;
  const top = el('div', 'passtop');
  const list = el('div', 'list');
  const days = Math.max(1, Math.ceil(seasonEndsIn(ctx.now()) / 86_400_000));
  const pill = el('span', 'pill', `${days}d left`);
  let scrolled = false;

  const cell = (track: Track, tier: number): HTMLButtonElement => {
    const p = w.pass;
    const claimed = p[track].includes(tier);
    const ready = canClaim(p, track, tier);
    const state = claimed ? 'claimed' : ready ? 'ready' : 'locked';
    const b = el('button', `cell ${track} ${state}`);
    const note = claimed ? '✓ Claimed' : ready ? 'Claim' : track === 'paid' && !p.premium ? 'Premium' : `Tier ${tier}`;
    b.append(el('b', '', rewardLabel(passReward(track, tier))), el('small', '', note));
    b.disabled = !ready;
    b.onclick = () => {
      if (ctx.claim(track, tier)) render();
    };
    return b;
  };

  const render = (): void => {
    const p = w.pass;
    const tier = passTier(p);
    const into = tier >= PASS_TIERS ? PASS_TIER_XP : p.xp - tier * PASS_TIER_XP;
    const line = el('div', 'line');
    line.append(
      el('b', '', `Season ${p.season}  ·  Tier ${tier}/${PASS_TIERS}`),
      el('span', '', tier >= PASS_TIERS ? 'Complete' : `${into} / ${PASS_TIER_XP} XP`),
    );
    const fill = el('i');
    fill.style.width = `${Math.round((100 * into) / PASS_TIER_XP)}%`;
    const bar = el('div', 'xpbar');
    bar.append(fill);
    const level = el('div', 'level');
    level.append(line, bar);

    const actions = el('div', 'passacts');
    if (!p.premium) {
      const unlock = el('button', 'btn primary small', `Unlock premium  ·  ${ctx.price('battle_pass')}`);
      unlock.onclick = async () => {
        unlock.disabled = true;
        await ctx.buyPremium();
        if (screens.isCurrent(d)) render();
      };
      actions.append(unlock);
    }
    const waiting = claimableCount(p);
    if (waiting > 0) {
      const all = el('button', 'btn small', `Claim all (${waiting})`);
      all.onclick = () => {
        if (ctx.claimAll().length > 0) render();
      };
      actions.append(all);
    }
    top.replaceChildren(level, actions);

    const keep = list.scrollTop;
    list.replaceChildren();
    const heads = el('div', 'tier heads');
    heads.append(el('span'), el('span', '', 'Free'), el('span', p.premium ? 'gold' : '', p.premium ? 'Premium' : 'Premium (locked)'));
    list.append(heads);
    let current: HTMLElement | null = null;
    for (let t = 1; t <= PASS_TIERS; t++) {
      const r = el('div', `tier${t <= tier ? ' reached' : ''}`);
      r.append(el('span', 'num', String(t)), cell('free', t), cell('paid', t));
      list.append(r);
      if (t === Math.min(PASS_TIERS, tier + 1)) current = r;
    }
    if (ctx.simulated && !p.premium) list.append(el('p', 'fine', SIM_NOTE));
    if (scrolled) {
      list.scrollTop = keep;
    } else {
      scrolled = true;
      // Start at the tier being worked on.
      if (current) list.scrollTop = Math.max(0, current.offsetTop - list.offsetTop - 120);
    }
  };

  d.append(header('Season Pass', pill, ctx.back), top, list);
  render();
}

// -------------------------------------------------------------------- energy

export interface EnergyCtx {
  wallet: Wallet;
  now(): number;
  simulated: boolean;
  /** Spend gems on a full refill. */
  refill(): boolean;
  /** Show a rewarded ad for one point. */
  ad(): Promise<boolean>;
  /** Called once the player has energy again. */
  ready(): void;
  back(): void;
}

/** Text for the live energy readouts: "Energy 3/5 · +1 in 12:05". */
export function energyText(w: Wallet, now: number): string {
  const e = energyAt(w.energy, now);
  return e.n >= ENERGY_MAX ? `Energy ${e.n}/${ENERGY_MAX}` : `Energy ${e.n}/${ENERGY_MAX}  ·  +1 in ${formatWait(e.nextMs)}`;
}

export function showEnergy(screens: Screens, ctx: EnergyCtx): void {
  const d = screens.open('energy');
  const w = ctx.wallet;
  const live = el('p', 'energy big', energyText(w, ctx.now()));
  live.dataset.energy = '';
  const refill = el('button', 'btn primary', `Refill for ${ENERGY_REFILL_GEMS} gems`);
  refill.disabled = !canRefillEnergy(w, ctx.now());
  refill.onclick = () => {
    if (ctx.refill()) ctx.ready();
  };
  const ad = el('button', 'btn', 'Watch an ad for +1');
  ad.onclick = async () => {
    if (await ctx.ad()) ctx.ready();
    else showEnergy(screens, ctx);
  };
  const back = el('button', 'btn ghost', 'Back');
  back.onclick = ctx.back;
  d.append(
    el('h2', '', 'Out of energy'),
    el('p', 'sub', `Each descent costs 1 energy. One comes back every ${Math.round(ENERGY_REGEN_MS / 60000)} minutes.`),
    live,
    refill,
    el('p', 'have', `You have ${fmt(w.gems)} gems`),
    ad,
    back,
  );
  if (ctx.simulated) d.append(el('p', 'fine', SIM_NOTE));
}
