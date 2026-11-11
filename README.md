# Shatter Dungeon

A bouncy-orb roguelite brick-breaker. Aim from the bottom, fire a stream of elemental orbs into descending monster blocks, pick a perk after every floor, and beat a boss every 10 floors to bank your loot.

Built so far: the core run loop (milestone 1), permanent progression between runs (milestone 2: forge, tavern, talent tree) and the simulated store (milestone 3: chests and orb merging, energy, season pass, gem packs). The endless tower, leaderboards and real billing are not built yet.

## Run it

```bash
npm install
npm run dev        # http://localhost:5183
npm run dev:lan    # same, reachable from a phone on your network
```

| Command | What it does |
|---|---|
| `npm test` | Vitest suite for the simulation |
| `npm run typecheck` | TypeScript, strict |
| `npm run build` | Production build into `dist/` |
| `npm run sim` | Headless bot plays seeded runs and prints a balance report |
| `npm run sim -- 100 9` | 100 runs, 9 candidate angles per turn (a sharper bot) |
| `npm run sim -- 100 5 0.5` | The same bot on a profile half way to fully upgraded (0 to 1) |
| `npm run career` | The bot plays 80 runs on one profile, spending coins and talent points as it goes |

## Layout

```
src/sim/        Pure, deterministic game simulation. No DOM.
  run.ts          Turn state machine and combat. Start here.
  physics.ts      Circle-vs-grid collision with a fixed 1/120s step.
  scaling.ts      Every difficulty and economy curve.
  perks.ts        Perk table and the stats derived from it.
  meta.ts         Forge and tavern upgrades, talents, hero levels, and what they add to a run.
  orbs.ts         Orb collection, merging, chest contents and odds.
  energy.ts       Energy that regenerates over time.
  pass.ts         Season pass tiers and rewards.
  store.ts        The player's wallet and everything that pays into or out of it.
  elements.ts, affixes.ts, boss.ts
src/view/       Canvas renderer, effects, synthesised audio, HUD, DOM screens (hub.ts: forge, tavern, talents; store.ts: store, orbs, pass, energy).
src/platform/   The one interface for purchases and ads, with a simulated implementation.
src/main.ts     Wires it together.
scripts/        Balance bot (sim.ts), career simulation (career.ts), shared bot logic (bot.ts).
tests/          Simulation tests.
```

The simulation never touches the DOM or the clock and takes all randomness from a seed, so the same seed and inputs always replay identically. `new Run(structuredClone(run.s))` gives an independent copy, which is how the bot looks ahead.

## Progression

Coins kept from a run are spent on the title screen. A boss kill banks everything carried; dying before one keeps a quarter.

- **Forge** (8 upgrades) strengthens the orbs: damage, crits, bounces per orb, and one mastery per element.
- **Tavern** (5 upgrades) strengthens the hero: health, breach armour, healing per floor, coin gain, and the share of unbanked coins kept.
- **Talents** (15 talents in three branches, 26 ranks) are bought with talent points. Each hero level gives one point, and XP comes from floors cleared (10 each) and bosses beaten (50 each). Resetting talents is free.

A run copies the profile when it starts (`new Run(seed, meta)`), so the simulation stays deterministic. All the numbers are in `src/sim/meta.ts`. The save file keeps its original localStorage key and older saves load with empty progression.

## Store, orbs, energy and pass

- **Orbs.** Chests hold orbs of the five kinds. Three of a level merge into one of the next (up to level 7), and the best orb of each kind adds 10% hit damage per level to that kind in every run.
- **Chests.** Wooden (2 orbs, 2,500 coins), Silver (5 orbs, 100 gems), Golden (10 orbs, 300 gems). Every boss beaten drops a Wooden Chest, and a rewarded ad gives one up to three times a day. Drop rates are shown in the store and defined in `CHESTS`. Rolls use a seed kept in the save, so reloading cannot reroll a chest.
- **Energy.** A run costs 1 of 5 energy; one comes back every 20 minutes. Out of energy, the player can refill for 40 gems, watch an ad for one point, or wait.
- **Season pass.** 20 tiers of 250 XP in four-week seasons, with a free and a premium reward on each tier. Pass XP is the same XP a run gives the hero.
- **Products.** A one-time starter pack, three gem packs and the premium pass, listed in `PRODUCTS` in `src/sim/store.ts`.

None of this logic reads the clock or the platform itself: the time is passed in, and a purchase is granted only after `Platform.purchase` resolves.

## Tuning

Change numbers in `src/sim/scaling.ts` (block HP, rows per floor, affix rates, hero damage) or `src/sim/perks.ts`, then run `npm run sim`. With the default bot a new profile's median run ends around floor 12 and about 70% of runs beat the first boss; a half-upgraded profile reaches about floor 19 and a full one about floor 29. Block HP grows 25% a floor up to floor 20 and faster after that (`DEEP_FLOOR`), which is what stops a full profile running away.

Upgrade prices live in `src/sim/meta.ts`. `npm run career` shows how long they last: at the moment the bot fills the talent tree in about 60 runs, buys the last upgrade after about 90, and has every orb at level 5 after about 100 without spending a gem.

## Monetization

Nothing here charges money. Real-money products (starter pack, gem packs, premium pass) and rewarded ads (revive, free chest, energy) all go through `src/platform/platform.ts`, and `SimulatedPlatform` always succeeds, so in this build gems are free. To ship, implement the same interface over the real store and ad SDKs, set the store up with the product ids in `PRODUCTS`, and move granting to verified receipts: the save is plain localStorage and can be edited by the player.

In dev builds, `window.__sd` exposes the live run for poking at from the console.
