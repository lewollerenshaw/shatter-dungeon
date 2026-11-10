# Shatter Dungeon

A bouncy-orb roguelite brick-breaker. Aim from the bottom, fire a stream of elemental orbs into descending monster blocks, pick a perk after every floor, and beat a boss every 10 floors to bank your loot.

Built so far: the core run loop (milestone 1) and permanent progression between runs (milestone 2: forge, tavern, talent tree). The shop, gacha, energy, battle pass and leaderboards are not built yet.

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
  elements.ts, affixes.ts, boss.ts
src/view/       Canvas renderer, effects, synthesised audio, HUD, DOM screens (hub.ts: forge, tavern, talents).
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

## Tuning

Change numbers in `src/sim/scaling.ts` (block HP, rows per floor, affix rates, hero damage) or `src/sim/perks.ts`, then run `npm run sim`. With the default bot a new profile's median run ends around floor 12 and about 70% of runs beat the first boss; a half-upgraded profile reaches about floor 19 and a full one about floor 29. Block HP grows 25% a floor up to floor 20 and faster after that (`DEEP_FLOOR`), which is what stops a full profile running away.

Upgrade prices live in `src/sim/meta.ts`. `npm run career` shows how long they last: at the moment the bot fills the talent tree in about 60 runs and buys the last upgrade after about 100.

## Monetization

Nothing here charges money. Coins and XP are earned only by playing. The only monetized moment so far is the revive (50 gems or a rewarded ad), and both go through `src/platform/platform.ts`. `SimulatedPlatform` always succeeds. To ship, implement the same interface over the real store and ad SDKs.

In dev builds, `window.__sd` exposes the live run for poking at from the console.
