# How everything is calculated

This follows a day's puzzle from date to final score. Weapon physics is summarized here, and [EFFECTS.md](EFFECTS.md) has the methods, sources, published comparisons and confidence levels.

It's a game model built from open literature, not a predictive tool. Numbers marked **game choice** are tuning decisions with no source behind them.

## From date to puzzle

All of this is in `src/lib/game/generator.ts`, seeded by `rng.ts`.

**Day number.** Local calendar date, where 5 November 2026 is No. 1. `?day=N` opens any puzzle, unscored.

**No server.** Every browser generates the puzzle itself from the day number and the theatre's data file. Goals are rounded to 2 significant figures and par to 3, which hides the tiny floating-point differences between browser engines. No test runs across different browsers yet.

| Roll | How |
|---|---|
| Theatre | Each of the 26 appears once per cycle, in a seeded order |
| Objective | Each of the 7 appears once per cycle. Blackout is limited to the United States and Northern Hemisphere maps, because a single burst covers anything smaller. On those two maps it also has a 50% chance of replacing the day's objective |
| Weather | Precipitation from a weighted list (clear is 3 in 7), wind bearing in 5° steps, surface wind 8 to 90 km/h |
| Arsenal | 1 to 3 weapon types from those allowed for the map. 2–5 warheads on a city, 3–8 on a region, 5–10 on the hemisphere. Blackout gets 2–3 warheads of 100 kt to 2 Mt |
| Conditions | None 25%, one 50%, two 25%, drawn from: locked height, locked yield, protected sites, fallout exclusion zone, no-fire zone, all must fly, yield budget |

**Targets.** City counterforce uses real landmarks from `theatres.ts`, needing 10, 20 or 50 psi. Region and hemisphere counterforce invents sites at thinly populated cells, needing 20, 50, 100 or 200 psi.

## Setting the goal and par

A greedy solver plays each rolled puzzle:

1. Warheads are taken in arsenal order, largest first. Each tries about 22 aim points on a city map, or 30 elsewhere, weighted toward population or structures, across its allowed yields and heights. It keeps the best, or skips the warhead if that scores higher.
2. Each warhead is then nudged in two shrinking rounds, and dropped if the plan is no worse without it.
3. The plan is snapped to settings the sliders and preset buttons can actually produce, so par is a score a player could enter.

| Objective | Goal | Par |
|---|---|---|
| Fatalities, structures, denial, blackout | 60% of the solver's score (**game choice**) | Solver's score |
| Economy | 40% of the damage a max-effort plan reaches | Solver's least yield meeting the goal |
| Surgical | 60% of the zone structures a max-effort plan destroys | Solver's collateral meeting the goal |
| Counterforce | Destroy every target | Solver's collateral |

If the solver can't pass a roll, or a blackout covers over 97% of the map, it rerolls up to 12 times. After that, a plain fatalities puzzle with no conditions is the fallback. `NUCLE_DAYS=365 npm test` checks that a year of puzzles has a passing plan the console can enter. It doesn't show a person can find one.

## Population and structures

Built by `scripts/build-data.ts`, stored per theatre in `static/data/`.

- **Population:** GHS-POP R2023A, the 2025 epoch, at 30 arcseconds.
- **Structures:** GHS-BUILT-S 2020 built-up area divided by **150 m² per structure (game choice)**. This is an estimate, not a count of buildings.
- **Resolution:** raster cells are merged by each theatre's `cellFactor`, about 1 km on city maps and coarser elsewhere. The top 16,000 cells are kept, ranked by share of population plus share of built area.
- **Lost people:** that cut drops real population on the widest maps. The Northern Hemisphere keeps about 4.5B of 8.1B, so totals there are lower than reality.

Streets and buildings on the map stream from OpenStreetMap and are **display only**. No score reads an individual building.

## One burst's effect on a cell

`Sim.compute` in `sim.ts` works out two fractions for every cell in range, using distance in great-circle km:

```
survivors = (1 - blast) × (1 - burns) × (1 - radiation)
standing  = (1 - blast structure loss) × (1 - fire)
```

| Term | Rule | Source |
|---|---|---|
| Overpressure | Brode eq. 62 by yield, height and range | Published |
| Blast fatalities | 0% at ≤1 psi, 2% at 2, 25% at 5, 75% at 12, 95% at 20, 100% at 50 | Estimate after OTA's bands |
| Blast structure loss | 1% at 1 psi, 8% at 2, 25% at 3, 60% at 5, 85% at 8, 100% at 12 | Estimate |
| Burns | 25% inside the third-degree radius, ramping over its outer 15% | Radius published, the 25% is a **game choice** |
| Fire | 30% of structures inside that same radius | **Game choice** |
| Prompt radiation | 90% inside the 1000 rad radius, ramping over its outer 15% | Radius published, the 90% is a **game choice** |

Each value is averaged over four points across a cell's width, so the score changes smoothly as you drag a warhead and doesn't jump at cell edges.

**Heights.** At or above 30 km there is no blast, heat, prompt radiation or fallout, only EMP.

## Fallout

Each burst lays a continuous dose-rate field (Miller's scaling system) along the wind's bearing:

- **Activity** scales with the fission share at that yield setting, from `fissionFractionAt`, times ground coupling. Coupling falls to zero at a burst height of 180 W^0.4 ft.
- **Shape** scales with total yield.
- **Drift** uses an effective wind estimated from the surface wind and cloud height, so it can exceed the wind shown.
- **Rain and snow** wash part of the cloud out into a shorter, hotter pattern.

**Deaths** come from dose, not rate. Dose = H+1 rate × 1.33 × a decay factor based on arrival time × 0.2 for shelter (estimate).

| Dose in rad | Fatal fraction |
|---|---|
| ≤200 | 0% |
| 300 | 10% |
| 450 | 50% |
| 600 | 90% |
| 1000+ | 100% |

**Known limit.** Published fallout models disagree at long range. For 1 Mt, the 1 rad/h contour reaches 259 miles in Miller, 492 in WSEG-10 and 895 in Glasstone & Dolan. The project deliberately uses Miller.

## EMP

Applies only at or above 30 km. The footprint is the horizon arc from the burst height, times a yield factor from 0.35 to 1 (estimate). Anyone inside counts as blacked out, and nobody dies from it.

## Combining all the bursts

`Sim.tally` merges bursts per cell:

```
cell survivors = product of each burst's survivors × (1 - fallout fatality from summed dose)
cell standing  = product of each burst's standing
```

Fallout rates and doses add across bursts. Overpressure does not: a protected or target site takes the highest single value.

| Total | Calculation |
|---|---|
| Fatalities | Sum of population × (1 − survivors) |
| Structures destroyed | Sum of structures × (1 − standing) |
| Population under fallout | Population in cells with a summed H+1 rate of 10 rad/h or more |
| Population blacked out | Population in cells inside any EMP footprint |
| Zone totals | The same, limited to cells inside a target zone |

**Exclusion zones** are tested at their centre and 8 points on their rim. **No-fire zones** test each ground zero's distance.

## Score, pass and rating

`scenario.ts`. A plan **passes** only if every check does: the objective plus all conditions.

| Objective | Score | Better |
|---|---|---|
| Fatalities | Total fatalities | Higher |
| Structures | Total destroyed | Higher |
| Denial | Population under 10+ rad/h | Higher |
| Blackout | Population covered, with under 1 fatality required | Higher |
| Counterforce | Total fatalities | Lower |
| Economy | Total kilotons | Lower |
| Surgical | Fatalities outside the zone | Lower |

**Rating** is 0 on a failed plan. Otherwise, 100 matches par and it can go above that:

```
higher is better:  100 × score / par
lower is better:   100 × (par + slack) / (score + slack)
```

`slack` is 0.2% of the map's kept population on counterforce and surgical days, and 0 otherwise. It stops a near-zero par from making any small collateral look catastrophic.

| Rating | Rank |
|---|---|
| 0 | Relieved of command |
| 1–59 | Second lieutenant |
| 60–74 | Captain |
| 75–89 | Major |
| 90–99 | Colonel |
| 100–109 | General |
| 110+ | Beyond command estimate |

## Difficulty

`difficulty.ts`, measured on simulated players after the strike:

```
score = 100 × ( 0.5 × (1 - plan success)
              + 0.2 × (1 - typical progress)
              + 0.2 × (1 - aim tolerance)
              + 0.1 × min(1, conditions / 3) )
```

- **Plan success:** the share of 60 plausible plans that pass with a rating of 50 or more. These plans aim sensibly and avoid what the rings visibly forbid, but don't optimize.
- **Typical progress:** the median plan's progress toward the objective.
- **Aim tolerance:** the share of 30 copies of the solver's plan that still pass, each with aim error up to 1.5% of the map radius. Shots snapped to a target stay exact.
- **Weights and bands** are **game choices**: Routine under 20, Priority under 40, Immediate under 60, Flash under 80, Flash Override above that. They have not been calibrated against real players.

## The daily board

`board.ts`. There's no server, so **the other rows are simulated**: the same fictional names for everyone that day, at about 66–104% of par with some jitter, plus the solver's own row. Lower-is-better days invert that ratio. Your row is placed by your real score. It isn't a real leaderboard.

## What's stored

Cookies only (`storage.ts`): the last 150 days of results, today's plan, theme and sound preferences. A finished day is re-scored from its saved plan when reloaded, so changing the model changes old reports.
