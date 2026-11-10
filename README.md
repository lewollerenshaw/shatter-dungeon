# Shatter Dungeon

A bouncy-orb roguelite brick-breaker. Aim from the bottom, fire a stream of elemental orbs into descending monster blocks, pick a perk after every floor, and beat a boss every 10 floors to bank your loot.

Milestone 1: the core run loop. Meta-progression, the shop, gacha, energy, battle pass and leaderboards are not built yet.

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

## Layout

```
src/sim/        Pure, deterministic game simulation. No DOM.
  run.ts          Turn state machine and combat. Start here.
  physics.ts      Circle-vs-grid collision with a fixed 1/120s step.
  scaling.ts      Every difficulty and economy curve.
  perks.ts        Perk table and the stats derived from it.
  elements.ts, affixes.ts, boss.ts
src/view/       Canvas renderer, effects, synthesised audio, HUD, DOM screens.
src/platform/   The one interface for purchases and ads, with a simulated implementation.
src/main.ts     Wires it together.
scripts/sim.ts  Balance bot.
tests/          Simulation tests.
```

The simulation never touches the DOM or the clock and takes all randomness from a seed, so the same seed and inputs always replay identically. `new Run(structuredClone(run.s))` gives an independent copy, which is how the bot looks ahead.

## Tuning

Change numbers in `src/sim/scaling.ts` (block HP, rows per floor, affix rates, hero damage) or `src/sim/perks.ts`, then run `npm run sim`. With the default bot the median run currently ends around floor 12, and about 70% of runs beat the first boss.

## Monetization

Nothing here charges money. The only monetized moment so far is the revive (50 gems or a rewarded ad), and both go through `src/platform/platform.ts`. `SimulatedPlatform` always succeeds. To ship, implement the same interface over the real store and ad SDKs.

In dev builds, `window.__sd` exposes the live run for poking at from the console.
