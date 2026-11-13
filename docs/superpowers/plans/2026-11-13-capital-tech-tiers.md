# Capital and Tech Tiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A lobby toggle that gives every human and nation a Capital whose tier (its level, 1–5) gates which structures and attacks they may build; it upgrades over 30 s, defends like a better SAM and Defense Post, is nuke-immune, and drops a tier and moves when its tile is captured.

**Architecture:** `UnitType.Capital` is a new upgradable structure whose `level()` is the owner's tier. Tier rules (requirements, costs, bonuses, "offline") live in `engine-lib` `Config` as pure functions over `PlayerLike`/`UnitLike`, so the engine and the client share them. The engine places the capital from `PlayerExecution` (one helper for first placement and relocation), runs its SAM through the existing `SAMLauncherExecution`, and finishes timed upgrades in a small `CapitalExecution`.

**Tech Stack:** TypeScript, Zod, Vitest, Lit (client).

**Spec:** `docs/superpowers/specs/2026-11-13-capital-tech-tiers-design.md`

## Global Constraints

- Everything is behind `GameConfig.capitals` (optional boolean, default off). With it off, behaviour, tests and replays are unchanged.
- Engine is deterministic: no `Math.random`/`Date`; integer tick math; `DetMath` for transcendental math.
- Engine changes need tests (`tests/`, using `setup()` from `tests/util/Setup.ts`).
- Tribes (`PlayerType.Bot`) never get a capital and are never gated.
- A human or nation that is alive with the toggle on always has exactly one capital once the spawn phase ends.
- All UI text through `translateText()` with keys in `resources/lang/en.json` only.
- Package import rules: `tests/LayerBoundaries.test.ts`.

Values pinned by the spec (and the plan's starting numbers where the spec left them to the builder):

| Thing | Value |
|---|---|
| Tier ladder | 1: City, DefensePost · 2: Port, Factory · 3: SAMLauncher, MissileSilo, AtomBomb · 4: HydrogenBomb, Warship · 5: MIRV. TransportShip always allowed |
| Max tier | 5 |
| Upgrade duration | 300 ticks (30 s), every tier |
| Upgrade cost to reach tier 2/3/4/5 | 250_000 / 750_000 / 2_000_000 / 5_000_000 gold (builder's call) |
| Economy bonus per tier above 1 | gold ×(1 + 0.10·(tier−1)), troop growth ×(1 + 0.05·(tier−1)) (builder's call) |
| Capital defense radius | 35 tiles (Defense Post is 30) |
| Capital SAM cooldown | 1 tick (SAM is 90) |
| Capital SAM range | `min(maxSamRange(), floor(samRange(tier) * 1.15))` |
| On capture | delete, re-place one tier lower (min 1), free; pending upgrade cancelled, no refund |

Note: Defense Post shelling is commented out in `DefensePostExecution.ts`, so a Defense Post's only live effect is the attack bonus within `defensePostRange()`. The capital copies that (radius 35); the spec's "86-tile shell range" has nothing to attach to and is not built.

## Review Focus

1. **Spawn re-pick:** a player re-picks their spawn during the spawn phase — no capital is placed until the phase ends, then exactly one, on their final spawn tile. (Task 2 test.)
2. **Last tiles:** the capital's tile is captured when it is the player's only remaining land — the player is dead, no capital is placed, nothing throws. (Task 2 test.)
3. **Captured enemy buildings:** a tier-1 player captures a tier-3 enemy's SAM — the SAM is offline for them. (Task 6 test.)
4. **Upgrade mid-capture:** capital captured at tick 150 of a 300-tick upgrade — new capital is one tier below the *old* tier, not upgrading, gold not refunded. (Task 4 test.)
5. **Toggle off:** no capital, `requiredCapitalTier` returns 0 for everything, existing build paths unchanged. (Task 1 and Task 3 tests.)

---

### Task 1: Toggle, Capital unit type, tier rules

**Files:**
- Modify: `packages/engine-api/src/Schemas.ts` (GameConfig object, next to `instantBuild`)
- Modify: `packages/engine-api/src/game/GameTypes.ts:194-245` (UnitType, Structures)
- Modify: `packages/engine-lib/src/game/PackedUnitUpdates.ts:33-50` (append `UnitType.Capital, // 17`)
- Modify: `packages/engine-lib/src/configuration/Config.ts` (unitInfo, new tier functions)
- Modify: `packages/engine/src/configuration/EngineConfig.ts:347` (unitCost)
- Modify: `packages/engine/src/game/PlayerImpl.ts:1599` (`canSpawnUnitType`: `case UnitType.Capital: return false;` — never hand-built)
- Modify: every other `assertNever(type)` switch over `UnitType` that `npm run typecheck` flags (client included) — treat Capital like City unless a later task says otherwise.
- Create: `packages/engine-lib/src/configuration/CapitalTiers.ts`
- Test: `tests/CapitalTiers.test.ts`

**Interfaces:**
- Produces:
  - `GameConfig.capitals?: boolean`
  - `UnitType.Capital = "Capital"`, included in `Structures` (so it appears in `BuildMenus`/`PlayerBuildable` and the build menu can offer its upgrade).
  - In `CapitalTiers.ts`:
    - `export const CAPITAL_MAX_TIER = 5`
    - `export const CAPITAL_UPGRADE_TICKS = 300`
    - `export const CAPITAL_DEFENSE_RANGE = 35`
    - `export const CAPITAL_SAM_COOLDOWN = 1`
    - `export function capitalTierCost(targetTier: number): Gold` — 0n for tier ≤ 1 or > 5.
    - `export function requiredCapitalTier(type: UnitType): number` — the ladder; 0 for TransportShip, Capital, and non-buildables.
    - `export function capitalOf(player: PlayerLike): UnitLike | null` — `player.units(UnitType.Capital)[0] ?? null`.
    - `export function capitalTier(player: PlayerLike): number` — capital's `level()`, or 0 if none.
  - On `Config`: `capitalsEnabled(): boolean` (`this._gameConfig.capitals ?? false`) and `requiredTierFor(type: UnitType, player: PlayerLike): number` — 0 when disabled or `player.type() === PlayerType.Bot`, else `requiredCapitalTier(type)`.
  - `unitInfo(Capital)`: `{ constructionDuration: 0, upgradable: true }`.
  - `unitCost(Capital)`: `(game, player, n = 0) => capitalTierCost(capitalTier(player) + 1 + n)`.

- [ ] **Step 1: Write the failing tests**

```ts
test("ladder", () => {
  expect(requiredCapitalTier(UnitType.City)).toBe(1);
  expect(requiredCapitalTier(UnitType.DefensePost)).toBe(1);
  expect(requiredCapitalTier(UnitType.Port)).toBe(2);
  expect(requiredCapitalTier(UnitType.Factory)).toBe(2);
  expect(requiredCapitalTier(UnitType.SAMLauncher)).toBe(3);
  expect(requiredCapitalTier(UnitType.MissileSilo)).toBe(3);
  expect(requiredCapitalTier(UnitType.AtomBomb)).toBe(3);
  expect(requiredCapitalTier(UnitType.HydrogenBomb)).toBe(4);
  expect(requiredCapitalTier(UnitType.Warship)).toBe(4);
  expect(requiredCapitalTier(UnitType.MIRV)).toBe(5);
  expect(requiredCapitalTier(UnitType.TransportShip)).toBe(0);
});
test("tier costs", () => {
  expect(capitalTierCost(2)).toBe(250_000n);
  expect(capitalTierCost(5)).toBe(5_000_000n);
  expect(capitalTierCost(6)).toBe(0n);
});
test("toggle off: nothing gated", async () => {
  const game = await setup("plains", {});
  const p = game.addPlayer(new PlayerInfo("p", PlayerType.Human, null, "p"));
  expect(game.config().requiredTierFor(UnitType.MIRV, p)).toBe(0);
});
test("toggle on: tribes never gated", async () => {
  const game = await setup("plains", { capitals: true });
  const bot = game.addPlayer(new PlayerInfo("b", PlayerType.Bot, null, "b"));
  expect(game.config().requiredTierFor(UnitType.MIRV, bot)).toBe(0);
});
```

- [ ] **Step 2:** `npx vitest tests/CapitalTiers.test.ts --run` → FAIL (missing exports).
- [ ] **Step 3:** Implement the Produces list. Run `npm run typecheck` and fill every flagged switch.
- [ ] **Step 4:** `npx vitest tests/CapitalTiers.test.ts --run` → PASS; `npm run typecheck` → clean.
- [ ] **Step 5:** Commit `feat: capital unit type, lobby flag and tier rules`.

---

### Task 2: Place and relocate the capital

**Files:**
- Create: `packages/engine/src/execution/CapitalPlacement.ts`
- Modify: `packages/engine/src/execution/PlayerExecution.ts:59-81` (tick)
- Modify: `packages/engine/src/game/UnitImpl.ts:96` (init `_samLauncherState` for Capital too, so `dynamicSamRange` works in Task 5)
- Test: `tests/CapitalPlacement.test.ts`

**Interfaces:**
- Consumes: Task 1 (`capitalOf`, `capitalTier`, `Config.capitalsEnabled`).
- Produces: `export function placeCapital(game: Game, player: Player, tier: number, near: TileRef | null): Unit | null` — picks a tile, builds `UnitType.Capital` there via `player.buildUnit(UnitType.Capital, tile, {})`, raises its level to `tier` without charging gold, adds `new CapitalExecution(capital)` (Task 4 creates the class; until then add only the SAM execution and leave a `// Task 4` hook) and `new SAMLauncherExecution(player, null, capital)`. Returns null if the player owns no tiles.

Tile choice (deterministic): if `near` is owned by the player, use it. Otherwise take the centre of `player.largestClusterBoundingBox` (or `near` when the box is null) and pick the owned tile with the smallest squared distance to it, ties to the lowest `TileRef`.
`// shortcut: scans player.tiles() (O(tiles)); fine because it runs only on placement/capture, upgrade if profiling shows it.`

PlayerExecution changes (all guarded by `capitalsEnabled()` and `player.type() !== PlayerType.Bot`):
- At the top of `tick`, if the player is alive, not in spawn phase, and `capitalOf(player)` is null → `placeCapital(mg, player, 1, player.spawnTile() ?? null)`.
- In the structure loop, before the DefensePost branch: if `u.type() === UnitType.Capital` and the tile now belongs to someone else → remember `tier = u.level()`, `tile = u.tile()`, `u.delete(true, captor)`, then if the player is still alive `placeCapital(mg, player, Math.max(1, tier - 1), tile)`. Never `captureUnit` a capital.

- [ ] **Step 1: Write the failing tests** — each with `setup("plains", { capitals: true, instantBuild: true })`, a human spawned with `SpawnExecution`, then `executeTicks`:
  - `"places one tier-1 capital on the spawn tile after spawn phase"`: `player.units(UnitType.Capital)` has length 1, level 1, tile === `player.spawnTile()`.
  - `"re-picked spawn: capital on the final spawn tile"`: with `autoEndSpawnPhase=false`, spawn twice at different tiles, end spawn phase, tick → one capital at the second spawn's tile.
  - `"toggle off: no capital"`: same with `{}` → length 0.
  - `"tribe: no capital"`: Bot player → length 0.
  - `"capture drops one tier and moves"`: raise capital to level 3 (`increaseLevel()` twice), enemy `conquer`s the capital's tile, tick → one capital, level 2, owned by the original player, on a tile they own, enemy owns no Capital.
  - `"tier 1 capture moves without dropping"`: level 1 → still level 1 after capture.
  - `"last tile captured: no capital, no throw"`: player owns only the capital tile; enemy conquers it; tick → player dead, `game.units(UnitType.Capital)` empty.
- [ ] **Step 2:** `npx vitest tests/CapitalPlacement.test.ts --run` → FAIL.
- [ ] **Step 3:** Implement `placeCapital` and the PlayerExecution changes.
- [ ] **Step 4:** Run the test file → PASS; `npx vitest PlayerExecution --run` → PASS.
- [ ] **Step 5:** Commit `feat: place capital on spawn and relocate on capture`.

---

### Task 3: Tier gate on building

**Files:**
- Modify: `packages/engine/src/game/PlayerImpl.ts:1458` (`canBuildUnitType`)
- Test: `tests/CapitalGate.test.ts`

**Interfaces:**
- Consumes: `Config.requiredTierFor`, `capitalTier` (Task 1).
- Produces: `canBuildUnitType` returns false when `capitalTier(this) < config.requiredTierFor(type, this)`. This also blocks `canUpgradeUnit` for gated types and every nation path that goes through `canBuild`.

- [ ] **Step 1: Write the failing tests** (`capitals: true, infiniteGold: true, instantBuild: true`, spawned human with a tier-1 capital):
  - `"tier 1 can build City and DefensePost, not Port/SAM/AtomBomb"` via `player.canBuild(type, ownedTile)`.
  - `"tier 3 unlocks SAM and Silo, not HydrogenBomb"` after `capital.increaseLevel()` ×2.
  - `"tier 5 unlocks MIRV"` (`buildableUnits` entry for MIRV is not blocked by tier: assert `requiredTierFor` ≤ tier; nuke spawn itself needs a silo, so test with a silo placed by `buildUnit`).
  - `"toggle off: SAM buildable with no capital"`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Add the check in `canBuildUnitType`.
- [ ] **Step 4:** Run the file → PASS; `npm run test:changed` → PASS.
- [ ] **Step 5:** Commit `feat: gate structures and attacks by capital tier`.

---

### Task 4: Timed capital upgrade

**Files:**
- Create: `packages/engine/src/execution/CapitalExecution.ts` (+ snapshot type registered in `packages/engine/src/snapshot/ExecutionRegistry.ts`, following `CityExecution`)
- Modify: `packages/engine/src/game/UnitImpl.ts` (new field + snapshot schema/version bump + `toUpdate`)
- Modify: `packages/engine/src/game/Game.ts` (Unit interface)
- Modify: `packages/engine/src/game/PlayerImpl.ts:1492-1511` (`canUpgradeUnit`, `upgradeUnit`)
- Modify: unit update schema in `engine-api` (whatever carries `markedForDeletion` to the client) and `PackedUnitUpdates.ts` if the field must be packed
- Modify: `CapitalPlacement.ts` (add the CapitalExecution at the `// Task 4` hook)
- Test: `tests/CapitalUpgrade.test.ts`

**Interfaces:**
- Produces on `Unit`: `capitalUpgradeAt(): Tick | null`, `startCapitalUpgrade(finishTick: Tick): void`, `cancelCapitalUpgrade(): void`. The value goes out in the unit update as `capitalUpgradeAt` so the client can draw progress. Unit snapshot: bump version, migration sets `capitalUpgradeAt: null`.
- `canUpgradeUnit(capital)`: also false if `capitalUpgradeAt() !== null` or `level() >= CAPITAL_MAX_TIER`.
- `upgradeUnit(capital)`: `removeGold(cost)`, `startCapitalUpgrade(ticks + CAPITAL_UPGRADE_TICKS)`; does **not** raise the level. Other types unchanged.
- `CapitalExecution(capital: Unit)`: each tick, if inactive → done; if `capitalUpgradeAt() !== null && ticks >= capitalUpgradeAt()` → `cancelCapitalUpgrade()` then `increaseLevel()`. Not active in spawn phase.
- A deleted capital takes its pending upgrade with it — the relocated one starts with `null`, which is the "no refund" rule.

- [ ] **Step 1: Write the failing tests:**
  - `"upgrade costs gold now and lands after 300 ticks"`: gold 250_000 → `UpgradeStructureExecution(player, capital.id())`; after 1 tick gold is 0 and level 1; after 299 more ticks level 2.
  - `"old tier holds during the upgrade"`: mid-upgrade `canBuild(Port)` is false; after it lands, true.
  - `"one upgrade at a time"`: second upgrade intent while pending → gold unchanged.
  - `"no upgrade past tier 5"`.
  - `"captured mid-upgrade: no refund, drops from old tier"`: level 3, start upgrade, tick 150, enemy conquers tile, tick → new capital level 2, `capitalUpgradeAt()` null, gold not refunded.
  - `"snapshot round-trip keeps the pending upgrade"`: snapshot mid-upgrade with `snapshotGame`, restore, tick to finish → level rises.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the file → PASS; `npx vitest Snapshot --run` → PASS.
- [ ] **Step 5:** Commit `feat: 30-second timed capital upgrades`.

---

### Task 5: Capital defenses, nuke immunity, no self-delete

**Files:**
- Modify: `packages/engine/src/execution/SAMLauncherExecution.ts:374` (cooldown) and range via config
- Modify: `packages/engine/src/configuration/EngineConfig.ts:715` (`dynamicSamRange`)
- Modify: `packages/engine/src/game/UnitImpl.ts:745-780` (`increaseLevel`/`decreaseLevel` treat Capital like SAMLauncher for missile queue and `_samLauncherState`)
- Modify: `packages/engine/src/execution/AttackExecution.ts:372`
- Modify: `packages/engine/src/execution/NukeExecution.ts:~450` (skip `UnitType.Capital`)
- Modify: `packages/engine/src/execution/DeleteUnitExecution.ts` (refuse Capital)
- Test: `tests/CapitalDefense.test.ts`

**Interfaces:**
- Consumes: `CAPITAL_SAM_COOLDOWN`, `CAPITAL_DEFENSE_RANGE` (Task 1); Capital already has a `SAMLauncherExecution` (Task 2).
- Produces:
  - Config `samCooldownFor(type: UnitType): number` — `CAPITAL_SAM_COOLDOWN` for Capital, else `SAMCooldown()`; used at `SAMLauncherExecution.ts:374`.
  - `dynamicSamRange`: for Capital, `min(maxSamRange(), floor(samRange(level) * 1.15))`, no ramp.
  - AttackExecution: `defenderHasDefensePost` is also true when `hasUnitNearby(tile, CAPITAL_DEFENSE_RANGE, UnitType.Capital, defender.id())`.

- [ ] **Step 1: Write the failing tests:**
  - `"capital range is 15% over SAM, capped"`: `dynamicSamRange(capital)` at level 1 equals `Math.floor(samRange(1) * 1.15)`; at level 5 ≤ 150.
  - `"capital intercepts back-to-back nukes"`: tier-3 capital (3 missiles), enemy launches 3 atom bombs at it 1 tick apart (follow `tests/NationNukeSamOverwhelm.test.ts` setup) → all 3 intercepted; a plain level-3 SAM in the same spot misses at least one when they arrive inside its 90-tick reload.
  - `"nuke does not delete the capital"`: detonate a hydrogen bomb on the capital tile → capital still active, same level.
  - `"defense bonus within 35 tiles"`: attack logic input for a tile 33 tiles from the defender's capital has `defenderHasDefensePost` true; 40 tiles → false.
  - `"cannot delete own capital"`: `DeleteUnitExecution` on it → still active.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the file → PASS; `npx vitest SAM Nuke --run` → PASS.
- [ ] **Step 5:** Commit `feat: capital acts as SAM and defense post, nuke-immune`.

---

### Task 6: Offline structures and tier economy

**Files:**
- Modify: `packages/engine-lib/src/configuration/CapitalTiers.ts` (add `isOffline`, multipliers)
- Modify: `packages/engine/src/execution/PortExecution.ts:42` (no trade ships while offline)
- Modify: `packages/engine/src/game/TrainStation.ts` (Port/Factory stop handlers pay nothing while offline)
- Modify: `packages/engine/src/execution/SAMLauncherExecution.ts` (offline SAMLauncher doesn't fire; capital is never offline)
- Modify: `packages/engine/src/game/PlayerImpl.ts:1680` (`nukeSpawn` ignores offline silos)
- Modify: `packages/engine/src/execution/PlayerExecution.ts:103` and `packages/engine-lib/src/configuration/Config.ts:391` (multipliers)
- Test: `tests/CapitalOffline.test.ts`

**Interfaces:**
- Produces in `CapitalTiers.ts`:
  - `export function isOffline(unit: UnitLike, enabled: boolean): boolean` — `enabled && unit.type() !== Capital && owner isn't Bot && requiredCapitalTier(unit.type()) > capitalTier(unit.owner())`.
  - `export function capitalGoldMultiplierPct(tier: number): number` — `100 + 10 * max(0, tier - 1)` (integer percent, so gold stays bigint-exact: `gold * BigInt(pct) / 100n`).
  - `export function capitalTroopMultiplier(tier: number): number` — `1 + 0.05 * max(0, tier - 1)`.
  - Config `isStructureOffline(unit: UnitLike): boolean` wrapping `isOffline(unit, capitalsEnabled())`.

- [ ] **Step 1: Write the failing tests:**
  - `"tier drop takes SAM offline and re-upgrade restores it"`: tier-3 player with a SAM; capture capital (→ tier 2) → `isStructureOffline(sam)` true and an incoming nuke is not intercepted; upgrade to 3 → false.
  - `"captured enemy SAM is offline for a tier-1 captor"`.
  - `"offline port spawns no trade ships"`: tier-1 owner of a port (via `buildUnit`), tick 600 → no TradeShip from it.
  - `"offline silo can't launch"`: tier-3 player with a silo drops to tier 2 (capital captured) → `isStructureOffline(silo)` true; re-upgrade to tier 3 → `canBuild(AtomBomb, enemyTile)` returns a tile again.
  - `"gold and troop bonus scale with tier"`: `capitalGoldMultiplierPct(3) === 120`, `capitalTroopMultiplier(5) === 1.2`; a tier-3 player's per-tick gold is 120% of an otherwise identical tier-1 player's.
  - `"toggle off: nothing offline"`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the file → PASS; `npm run test:changed` → PASS.
- [ ] **Step 5:** Commit `feat: offline structures above tier, tier economy bonus`.

---

### Task 7: Nations upgrade their capital

**Files:**
- Modify: `packages/engine/src/execution/nation/NationStructureBehavior.ts` (spending choices; `upgradeStructure` at :939)
- Test: `tests/NationCapital.test.ts`

**Interfaces:**
- Consumes: `capitalOf`, `canUpgradeUnit`, `UpgradeStructureExecution`.
- Produces: when `capitalsEnabled()`, before other structure spending, if the nation's next wanted structure is tier-locked (or it has nothing else to build) and `canUpgradeUnit(capital)`, it upgrades the capital via the existing `upgradeStructure(capital)`.

- [ ] **Step 1: Write the failing test** `"nation climbs tiers"`: `setup` with one nation, `capitals: true`, `startingGold: 10_000_000`, end spawn phase, `executeTicks(game, 3000)` → the nation's capital level ≥ 3 and it owns no structure whose `requiredCapitalTier` exceeds its tier.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the file → PASS; `npx vitest Nation --run` → PASS.
- [ ] **Step 5:** Commit `feat: nations upgrade their capital`.

---

### Task 8: Client — lobby toggle, capital, locked and offline UI

**Files:**
- Modify: `src/client/HostLobbyModal.ts` and `src/client/SinglePlayerModal.ts` (copy every `instantBuild` touchpoint: state, toggle, reset, load, send)
- Modify: `src/client/utilities/LobbySettingsSummary.ts` (show "Capitals" when on)
- Modify: `src/client/hud/layers/BuildMenu.ts` (locked items: disabled with "Tier N" label; Capital entry shows upgrade cost and progress)
- Modify: structure rendering in `src/client/render/` (Capital uses the City sprite path with its own icon, tier number, upgrade progress from `capitalUpgradeAt`; offline structures greyed via `config.isStructureOffline`)
- Modify: `resources/lang/en.json`
- Test: `tests/client/BuildMenuCapital.test.ts`

**Interfaces:**
- Consumes: `GameConfig.capitals`, `requiredTierFor`, `capitalTier`, `isStructureOffline`, unit update `capitalUpgradeAt`.
- New `en.json` keys (exact): `host_modal.capitals` = "Capitals", `build_menu.requires_tier` = "Requires capital tier {tier}", `unit_type.capital` = "Capital", `build_menu.capital_upgrading` = "Upgrading… {seconds}s", `build_menu.offline` = "Offline — needs capital tier {tier}". Put each under the existing section its siblings use (find `instant_build`).

- [ ] **Step 1: Write the failing test:** render `BuildMenu` with a player view at tier 1 and `capitals: true` → the Port button is disabled and its text contains the `requires_tier` string with tier 2.
- [ ] **Step 2:** `npx vitest tests/client/BuildMenuCapital.test.ts --run` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Test → PASS; `npm run lint` and `npm run typecheck` → clean.
- [ ] **Step 5:** Manual check with the run-openfront skill: single-player game with Capitals on — capital appears on spawn, Port locked at tier 1, upgrading shows a 30 s countdown, then Port unlocks.
- [ ] **Step 6:** Commit `feat: capitals lobby toggle and build menu tiers`.

---

### Final check

- [ ] `npm test` → all pass (includes long sim tests and `LayerBoundaries`).
- [ ] `npm run build-prod` → succeeds.
