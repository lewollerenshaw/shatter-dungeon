import {
  BRANCHES,
  TALENTS,
  TALENT_BY_ID,
  UPGRADES,
  freePoints,
  levelInfo,
  spentPoints,
  talentParent,
  talentRank,
  talentStatus,
  upgradeCost,
  upgradeLevel,
  type Profile,
  type ShopId,
} from '../sim/meta';
import { fmt } from '../util';
import { GLYPH, el, type Screens } from './screens';

const SHOP_COPY: Record<ShopId, { title: string; sub: string }> = {
  forge: { title: 'Forge', sub: 'Permanent upgrades for your orbs.' },
  tavern: { title: 'Tavern', sub: 'Permanent upgrades for your hero.' },
};

/** Back button, centred title, and a status pill on the right. */
export function header(title: string, pill: HTMLElement, onBack: () => void): HTMLElement {
  const bar = el('div', 'bar');
  const back = el('button', 'back', '‹ Back');
  back.onclick = onBack;
  bar.append(back, el('h2', '', title), pill);
  return bar;
}

/**
 * Forge or tavern: a list of upgrades bought with coins. `on.buy` does the
 * purchase and saving; the screen only redraws.
 */
export function showShop(
  screens: Screens,
  shop: ShopId,
  profile: Profile,
  on: { buy(id: string): boolean; back(): void },
): void {
  const d = screens.open(`meta shop ${shop}`);
  const purse = el('span', 'pill gold');
  const list = el('div', 'list');

  const render = (): void => {
    purse.textContent = `◆ ${fmt(profile.coins)}`;
    list.replaceChildren();
    for (const u of UPGRADES) {
      if (u.shop !== shop) continue;
      const level = upgradeLevel(profile, u.id);
      const maxed = level >= u.max;
      const cost = upgradeCost(u, level);
      const row = el('div', `up icon-${u.icon}${maxed ? ' maxed' : ''}`);
      const body = el('span', 'body');
      const head = el('span', 'head');
      head.append(el('b', '', u.name), el('i', 'lv', `Lv ${level}/${u.max}`));
      body.append(head);
      if (level > 0) body.append(el('small', '', u.effect(level)));
      if (!maxed) body.append(el('small', 'next', `Next: ${u.effect(level + 1)}`));
      const buy = el('button', 'buy', maxed ? 'MAX' : `◆ ${fmt(cost)}`);
      buy.disabled = maxed || profile.coins < cost;
      buy.setAttribute('aria-label', maxed ? `${u.name} is at its maximum` : `Buy ${u.name} for ${cost} coins`);
      buy.onclick = () => {
        if (on.buy(u.id)) render();
      };
      row.append(el('span', 'chip', GLYPH[u.icon]), body, buy);
      list.append(row);
    }
  };

  d.append(header(SHOP_COPY[shop].title, purse, on.back), el('p', 'sub', SHOP_COPY[shop].sub), list);
  render();
}

/** The talent tree: three branches, learned top to bottom with points from hero levels. */
export function showTalents(
  screens: Screens,
  profile: Profile,
  on: { learn(id: string): boolean; reset(): void; back(): void },
): void {
  const d = screens.open('meta talents');
  const pill = el('span', 'pill');
  const level = el('div', 'level');
  const tree = el('div', 'tree');
  const detail = el('div', 'detail');
  const reset = el('button', 'btn ghost small', 'Reset talents');
  let selected = (TALENTS.find((t) => talentStatus(profile, t.id) === 'ready') ?? TALENTS[0]).id;

  const render = (): void => {
    const info = levelInfo(profile.xp);
    const free = freePoints(profile);
    pill.textContent = free === 1 ? '1 point' : `${free} points`;
    pill.classList.toggle('hot', free > 0);

    const fill = el('i');
    fill.style.width = `${info.need > 0 ? Math.round((100 * info.into) / info.need) : 100}%`;
    const xpBar = el('div', 'xpbar');
    xpBar.append(fill);
    const line = el('div', 'line');
    line.append(
      el('b', '', `Hero level ${info.level}`),
      el('span', '', info.need > 0 ? `${info.into} / ${info.need} XP` : 'Max level'),
    );
    level.replaceChildren(line, xpBar);

    tree.replaceChildren();
    BRANCHES.forEach((name, bi) => {
      const col = el('div', `branch b${bi}`);
      col.append(el('h3', '', name));
      for (const t of TALENTS.filter((x) => x.branch === bi).sort((a, b) => a.tier - b.tier)) {
        const rank = talentRank(profile, t.id);
        const status = talentStatus(profile, t.id);
        const parent = talentParent(t);
        const node = el('button', `node ${status}`);
        if (rank > 0) node.classList.add('owned');
        if (parent && talentRank(profile, parent.id) > 0) node.classList.add('linked');
        if (t.id === selected) node.classList.add('sel');
        node.setAttribute('aria-label', `${t.name}, rank ${rank} of ${t.max}`);
        node.append(el('span', 'glyph', GLYPH[t.icon]), el('i', 'rank', `${rank}/${t.max}`));
        node.onclick = () => {
          selected = t.id;
          render();
        };
        col.append(node);
      }
      tree.append(col);
    });

    const t = TALENT_BY_ID[selected];
    const rank = talentRank(profile, t.id);
    const status = talentStatus(profile, t.id);
    const parent = talentParent(t);
    const head = el('div', 'head');
    head.append(el('b', '', t.name), el('i', 'lv', `Rank ${rank}/${t.max}`));
    const label =
      status === 'ready'
        ? 'Learn  ·  1 point'
        : status === 'maxed'
          ? 'Fully learned'
          : status === 'locked'
            ? `Needs ${parent ? parent.name : 'the talent above'}`
            : 'No talent points';
    const learn = el('button', 'btn primary small', label);
    learn.disabled = status !== 'ready';
    learn.onclick = () => {
      if (on.learn(t.id)) render();
    };
    detail.className = `detail b${t.branch}`;
    detail.replaceChildren(head, el('p', '', t.desc), learn);

    reset.hidden = spentPoints(profile) === 0;
  };

  reset.onclick = () => {
    on.reset();
    render();
  };
  d.append(
    header('Talents', pill, on.back),
    level,
    tree,
    detail,
    el('p', 'fine', 'Every hero level earns a talent point. Levels come from floors cleared and bosses beaten.'),
    reset,
  );
  render();
}
