# Capital and tech tiers — design

## Intent

Make OpenFront play like a fast-paced classic RTS — build up a base, race up a
tech ladder — while keeping the territory fighting exactly as it is. Every
player gets a Capital that they upgrade with gold; its tier decides which
buildings they may build. Losing the capital costs a tier and switches off the
buildings above it, so raiding a capital is a strong, game-swinging move.

## Goals

- A Capital on every player's spawn, upgraded in place with gold.
- A tier ladder that gates every buildable structure and attack.
- Capital capture: drop a tier, buildings above the tier go offline until
  the player pays to climb back.
- Higher tiers also boost the economy, so upgrading is worth it on its own.
- Matches feel fast: tiers are cheap and quick enough that the race is the game.
- AI nations play by the same rules.

## Non-goals

- Direct unit control (select an army, move it). Troops stay a single number
  that pushes across borders.
- Changes to attack, troop or territory rules.
- Folding buildings into the capital (option A in Approaches).
- New structure types beyond the Capital.

## Anti-goals (a failure even if it works)

- Nukes reachable in the opening minutes — the ladder must hold them back.
- A "no capital" state: a player alive always has exactly one capital.
- A captured capital ending the game outright.
- AI nations ignoring tiers.

## Approaches considered

- **A. Everything lives in the capital.** No buildings around your land; tiers
  unlock abilities. Fewest clicks, but territory only matters for land and
  gold, and nothing is worth raiding but the capital.
- **B. Capital as tech gate (picked).** Buildings stay where they are, each
  needs a minimum capital tier, like a barracks before a factory. Gives the
  classic build-order race, keeps enemy buildings worth raiding, reuses almost
  all existing structures.
- **C. Capital plus a few specialists.** Most structures fold into the capital,
  a few (Port, Silo) stay. Middle ground, most judgement calls.

The user picked **B**.

## Decided by the user

- Option B, capital as tech gate.
- Territory fighting unchanged.
- **Lobby toggle**, not always-on. A `GameConfig` flag (default off) with a
  lobby control. With it off the game plays exactly as today: no capital, no
  gating, existing tests and replays unchanged. Every new code path checks it.
- **The capital is immune to nukes**: blasts never delete it
  (`NukeExecution` skips it). Only land capture drops its tier, so the
  drop-and-move lives in `PlayerExecution` alone.
- **The capital is a better SAM and Defense Post**, active from tier 1:
  - Defense Post part: 15% bigger than a Defense Post — defense range
    30 → 35 tiles, shell targeting range 75 → 86 tiles; same defense/speed
    bonuses and shell rate.
  - SAM part: practically no reload — cooldown of 1 tick instead of 90, so
    it can intercept nuke after nuke. Range (Claude's call): SAM range at
    the capital's tier, also +15%, capped at `maxSamRange()`. Hit chance as
    a normal SAM.
  - These stay active regardless of tier and never go offline.
- **Upgrades take 30 seconds** (300 ticks) per tier, regardless of tier.
  This is new — today's `PlayerImpl.upgradeUnit` is instant — so the capital
  needs an "upgrading" state (see How it's built).
- On capture: the capital drops tiers, buildings above the new tier go
  offline, and climbing back costs gold. Specifically (agreed):
  - The captured capital is destroyed; the player drops **one** tier.
  - A new capital appears **free**, automatically, on the player's largest
    remaining connected landmass, at the lower tier.
  - At tier 1 it cannot drop further; losing it only moves it.
  - Offline buildings come back when the player upgrades back to their tier.

## Proposed by Claude (not objected to; tune freely)

Tier ladder:

| Tier | Unlocks |
|------|---------|
| 1 (start) | City, Defense Post |
| 2 | Port, Factory |
| 3 | SAM Launcher, Missile Silo, Atom Bomb |
| 4 | Hydrogen Bomb, Warship |
| 5 | MIRV |

(The proposal said "Warship upgrades" at tier 4; Warships aren't upgradable
today, so read it as "Warship unlocks at tier 4". Transport ships stay
always available — they're part of territory fighting.)

## How it's built (Claude's calls)

- **New structure `UnitType.Capital`** in `engine-api` `GameTypes.ts`, added to
  `Structures`, marked `upgradable` in `Config.unitInfo`, so it uses the
  existing level/upgrade path (`UpgradeStructureExecution`, `unit.level()`).
  Its level *is* the player's tier.
- **The Capital can't be built by hand** and there is at most one per player.
  It's created when the player spawns (`SpawnExecution`), on the spawn tile.
- **Tier requirements live in the rules `Config`** (`engine-lib`), e.g.
  `requiredCapitalTier(type)`, read by both the engine's build check
  (`PlayerImpl.canBuild` / `buildableUnits`) and the client's build menu, so
  locked items show the tier needed.
- **Upgrade cost per tier** comes from `Config` (`EngineConfig` holds costs
  today). Starting numbers are the builder's call, aiming at "tier 3 in a few
  minutes, tier 5 late game".
- **Timed upgrade (Claude's calls)**: gold is paid up front; the capital is
  marked upgrading with a finish tick (snapshotted). The old tier stays in
  force until it finishes; one upgrade at a time. If the capital is captured
  mid-upgrade, the upgrade is cancelled with **no refund** — that's
  the cost of being raided. The client shows a progress bar on the capital
  and in the build menu. Other structures keep today's instant upgrades.
- **Tribes get no capital** (Claude's call): they never build. The gate and
  the "exactly one capital" rule apply to humans and nations only.
- **Self-deletion of the capital is blocked** in `DeleteUnitExecution` and
  `canDeleteUnit`.
- **Capture**: `PlayerExecution.tick` already decides what happens to a
  structure whose tile changed hands (Defense Posts are deleted, others are
  captured). The Capital gets its own branch: delete it, then re-create it
  for the old owner one level lower on their largest landmass. It is never
  handed to the captor.
- **Offline buildings**: a structure is offline when
  `requiredCapitalTier(type) > owner's tier`. This is computed, not stored, so
  it covers both a tier drop and a captor taking buildings above their own
  tier. Offline means: Port/Factory give no gold or trade (Cities unlock at tier 1,
  so they can never be offline), SAMs and
  Defense Posts don't fire or defend, Silos can't launch. Each affected
  execution checks one shared helper.
- **Economy boost** per tier: gold and troop growth multipliers in `Config`,
  same shape as the landmark bonus.
- **AI nations** (`NationStructureBehavior`, `NationNukeBehavior`): add
  "upgrade capital" as a spending choice, and respect the tier check (they go
  through `canBuild`, so the gate mostly applies for free).
- **Client**: render the Capital (reuse the City sprite path with its own
  icon), show tier on it, show locked build-menu entries with the required
  tier, show offline buildings greyed out. All text through `translateText()`
  with `en.json` entries.
- **Tests** (required for engine changes): spawn creates a tier-1 capital;
  build blocked below tier; upgrade raises tier and unlocks; capture drops one
  tier, relocates to largest landmass, never below 1; a nuke never deletes
  it; it intercepts back-to-back nukes and defends like a 15%-bigger post;
  upgrade finishes after 300 ticks and is cancelled without refund on loss;
  toggle off leaves the game unchanged; buildings above tier go
  offline and come back after re-upgrade; captured enemy buildings above the
  captor's tier are offline; nations upgrade their capital.

## Constraints

- Engine stays deterministic: integer math, seeded PRNG, `DetMath`.
- A new `UnitType` touches the packed unit update index
  (`PackedUnitUpdates.ts`) and the snapshot format — add a migration that
  defaults the toggle to off, so old snapshots need no capitals.
- Package import rules (`tests/LayerBoundaries.test.ts`).

## Left to the builder

- Exact tier costs, upgrade durations and economy multipliers.
- "Largest landmass" tie-breaking (deterministic, e.g. lowest tile ref).
- Capital art and how tier is drawn on it.
