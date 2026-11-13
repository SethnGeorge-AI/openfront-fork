# Capturable Landmarks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real-world landmarks (Eiffel Tower, Great Pyramid, …) placed on the World and continent maps; whoever owns a landmark's tile earns bonus gold and faster troop growth for as long as they hold it, and every landmark shows on the map as a marker with a styled info card.

**Architecture:** Landmarks are map data (`landmarks` in each map's `info.json` / `manifest.json`), parsed by the manifest schema and carried through `TerrainMapData` into `createGame`. Ownership is never stored: a landmark is held by whoever owns its tile, so the engine needs no new state, intents, snapshots or `GameUpdates`. `PlayerExecution` adds the bonus each tick; the client reads the same tiles through `GameView` and draws a Lit overlay anchored to the map with `TransformHandler.worldToScreenCoordinates`.

**Tech Stack:** TypeScript, zod (manifest schema), engine packages (`engine-api`, `engine-lib`, `engine`), Lit + Tailwind (HUD), Vitest.

**Spec:** No separate spec doc; the decisions come from the user in this session (2026-11-13):
1. Landmarks are **capturable sites with a gameplay bonus**, shown with an icon on the map and a hover/click info card styled like the rest of the HUD (card mock: name, `Owner: <player>`, gold bonus).
2. Maps: **World + continent maps**: `world`, `europe`, `asia`, `africa`, `northamerica`, `southamerica`, `australia`.
3. Holding a landmark gives bonus gold **and boosts troop creation while holding it** (no timer: the boost ends the tick the landmark is lost).

## Global Constraints

- Engine code stays deterministic: no `Math.random`/`Date.now`, use `engine-lib/DetMath` for `pow`/`exp`/… (Oxlint enforces). `packages/engine*` changes must include tests (CLAUDE.md).
- Package boundaries per `tests/LayerBoundaries.test.ts`: schema in `engine-api`, shared rules (`Config`) in `engine-lib`, simulation in `engine`; the client imports only `engine-api`/`engine-lib`/`shared`.
- Bonus values (fixed by this plan, in `packages/engine-lib/src/configuration/Config.ts`):
  - `LANDMARK_GOLD_PER_TICK = 25n` per landmark held (= 15,000 gold/min at 10 ticks/s; base income is 100n/tick).
  - `LANDMARK_TROOP_BONUS = 0.1`: troop growth `toAdd *= 1 + LANDMARK_TROOP_BONUS * landmarksHeld`, applied **before** the max-troops clamp, so holding landmarks never exceeds `maxTroops`.
- Landmark names are map data, shown untranslated like nation names. All other new UI text goes through `translateText()` with keys added to `resources/lang/en.json` only.
- `info.json` and `manifest.json` carry identical `landmarks` arrays (the generator copies `info.json` into `manifest.json`; edit both, or run the generator).
- Landmark coordinates are tile `[x, y]` on the **normal-size** map and must be a land tile; compact maps halve them (`Math.floor(c / 2)`), as nations do.
- New art (marker icon) must be original. Repo assets are CC BY-SA 4.0; never copy from OpenFront's CDN or `proprietary/`.

## Review Focus

1. **Compact map size**: coordinates halved can land on water or collide with another landmark. Expect: loader still accepts it and the landmark still works (test in Task 1: compact halving keeps every shipped landmark on land).
2. **Two landmarks on one tile** (or one map listing the same name twice). Expect: rejected by the schema with a clear path (test in Task 1).
3. **Player at max troops holding landmarks**. Expect: no growth past `maxTroops` (test in Task 2).
4. **Landmark lost mid-game** (tile conquered, owner dies). Expect: the bonus stops that tick and the new owner gets it, with no lingering state (test in Task 2).
5. **Maps without landmarks / replays of older games**. Expect: `landmarks` is optional; games, replays and snapshots behave exactly as before (test in Task 2: `setup()` with no landmarks gives unchanged income).

---

### Task 1: Landmark map data: schema, loader, and the 7 maps

**Files:**
- Modify: `packages/engine-api/src/game/MapManifest.ts` (add `LandmarkSchema`, `landmarks` to `mapInfoShape`, bounds + duplicate checks in the manifest `superRefine`)
- Modify: `packages/engine-api/src/game/MapFiles.ts` (re-export `Landmark` type next to `Nation`)
- Modify: `packages/engine-lib/src/game/TerrainMapLoader.ts` (`TerrainMapData.landmarks`, compact halving, land validation)
- Modify: `map-generator/info.schema.json` (regenerate: `npm run gen-map-schema`)
- Modify: `map-generator/assets/maps/{world,europe,asia,africa,northamerica,southamerica,australia}/info.json` and the matching `resources/maps/<map>/manifest.json`
- Test: `tests/MapManifestSchema.test.ts`, new `tests/Landmarks.test.ts`

**Interfaces:**
- Produces:
  - `LandmarkSchema = z.strictObject({ name: z.string().min(1), coordinates: Coordinates })` and `type Landmark = z.infer<typeof LandmarkSchema>` exported from `@openfront/engine-api/game/MapManifest`.
  - `mapInfoShape.landmarks: z.array(LandmarkSchema).optional()`; manifest rejects out-of-bounds coordinates (path `["landmarks", i, "coordinates"]`), duplicate names, and two landmarks on the same tile.
  - `TerrainMapData.landmarks: Landmark[]` (always an array, `[]` when the manifest has none; halved on `GameMapSize.Compact`).
  - `loadTerrainMap` throws `Map <map>: landmark "<name>" is not on land` when a (scaled) landmark tile is water.

- [ ] **Step 1: Write failing schema tests** in `tests/MapManifestSchema.test.ts`: a manifest with `landmarks: [{ name: "A", coordinates: [width, 0] }]` fails with path `landmarks.0.coordinates`; two entries with the same name fail; two entries with equal coordinates fail; a manifest without `landmarks` still parses.
- [ ] **Step 2: Run** `npx vitest tests/MapManifestSchema.test.ts --run`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement** the schema in `MapManifest.ts`: add `landmarks` to the `groups` bounds loop and add the duplicate checks in the same `superRefine`. Re-export `Landmark` from `MapFiles.ts`. Run `npm run gen-map-schema`.
- [ ] **Step 4: Run** the schema test. Expected: PASS.
- [ ] **Step 5: Write failing loader + data tests** in `tests/Landmarks.test.ts`:
  - `loadTerrainMap` on `tests/testdata/maps/plains` with a manifest copy holding `landmarks: [{ name: "A", coordinates: [10, 10] }]` and `mapSize: Compact` returns `landmarks[0].coordinates` equal to `[5, 5]`.
  - A landmark placed on a water tile of `tests/testdata/maps/ocean_and_land` makes `loadTerrainMap` reject with `/not on land/`.
  - For each of the 7 maps: `info.json.landmarks` deep-equals `manifest.json.landmarks`, has at least 8 entries, and every landmark is on land in **both** `map.bin` and (halved) `map4x.bin`. Read the bins with `fs` the way `tests/util/Setup.ts` does and check with `GameMap.isLand(ref(x, y))`.
- [ ] **Step 6: Run** `npx vitest tests/Landmarks.test.ts --run`. Expected: FAIL (no `landmarks` in `TerrainMapData`, no map data yet).
- [ ] **Step 7: Implement the loader** in `TerrainMapLoader.ts`: halve `landmarks` alongside `nations` for Compact, validate each on `gameMap` with `isLand`, and return `landmarks: manifest.landmarks ?? []`.
- [ ] **Step 8: Add the landmark data** to each map's `info.json` and `manifest.json`. Names (in this order):
  - **world:** Great Pyramid of Giza, Eiffel Tower, Colosseum, Big Ben, Stonehenge, Kremlin, Statue of Liberty, Golden Gate Bridge, Grand Canyon, Niagara Falls, Chichen Itza, Machu Picchu, Christ the Redeemer, Iguazu Falls, Victoria Falls, Mount Kilimanjaro, Petra, Burj Khalifa, Taj Mahal, Mount Everest, Great Wall of China, Mount Fuji, Angkor Wat, Sydney Opera House, Uluru
  - **europe:** Eiffel Tower, Colosseum, Big Ben, Stonehenge, Sagrada Familia, Acropolis, Neuschwanstein Castle, Kremlin, Brandenburg Gate, Matterhorn
  - **asia:** Great Wall of China, Forbidden City, Taj Mahal, Mount Everest, Mount Fuji, Angkor Wat, Petra, Burj Khalifa, Borobudur, Petronas Towers
  - **africa:** Great Pyramid of Giza, Abu Simbel, Mount Kilimanjaro, Victoria Falls, Table Mountain, Timbuktu, Lalibela, Great Zimbabwe
  - **northamerica:** Statue of Liberty, Golden Gate Bridge, Grand Canyon, Niagara Falls, Mount Rushmore, Yellowstone, Chichen Itza, CN Tower, Teotihuacan, Denali
  - **southamerica:** Machu Picchu, Christ the Redeemer, Iguazu Falls, Angel Falls, Aconcagua, Salar de Uyuni, Nazca Lines, Torres del Paine
  - **australia:** Sydney Opera House, Uluru, Daintree Rainforest, Twelve Apostles, Kakadu, Bungle Bungle Range, Pinnacles Desert, Cradle Mountain

  Coordinates: locate each place on `map-generator/assets/maps/<map>/image.png`. The map's existing `nations` entries are real places with known positions, so fit a linear lat/long → pixel mapping from three of them, then move the result to the nearest land tile if the test reports water.
- [ ] **Step 9: Run** `npx vitest tests/Landmarks.test.ts tests/MapManifestSchema.test.ts tests/MapConsistency.test.ts --run`. Expected: PASS.
- [ ] **Step 10: Commit**

```bash
git add packages/engine-api packages/engine-lib/src/game/TerrainMapLoader.ts map-generator resources/maps tests/Landmarks.test.ts tests/MapManifestSchema.test.ts
git commit -m "feat: landmark map data for World and continent maps"
```

### Task 2: Engine: landmark bonus while held

**Files:**
- Modify: `packages/engine-lib/src/configuration/Config.ts` (constants, `troopIncreaseRate` parameter)
- Modify: `packages/engine/src/game/Game.ts` (interface), `packages/engine/src/game/GameImpl.ts` (`createGame` + implementation)
- Modify: `packages/engine/src/execution/PlayerExecution.ts:99-105`
- Modify: `packages/engine/src/GameRunner.ts:79-86` (pass `gameMap.landmarks`), `tests/util/Setup.ts` (optional `landmarks` param, last)
- Test: `tests/core/LandmarkBonus.test.ts`

**Interfaces:**
- Consumes: `Landmark`, `TerrainMapData.landmarks` (Task 1).
- Produces:
  - `export const LANDMARK_GOLD_PER_TICK: Gold = 25n;` `export const LANDMARK_TROOP_BONUS = 0.1;` in `engine-lib/configuration/Config.ts`.
  - `Config.troopIncreaseRate(player: PlayerLike, landmarksHeld: number = 0): number`.
  - `createGame(humans, nations, gameMap, miniGameMap, config, teamGameSpawnAreas?, landmarks: Landmark[] = [])`.
  - `Game.landmarks(): readonly { name: string; tile: TileRef }[]` and `Game.landmarksHeldBy(player: Player): number` (count of landmark tiles whose `owner()` is `player`).
  - `setup(..., nations = [], landmarks: Landmark[] = [])` in `tests/util/Setup.ts`.

- [ ] **Step 1: Write failing tests** in `tests/core/LandmarkBonus.test.ts`, using `setup("plains", {}, [humanA, humanB], __dirname, TestConfig, true, [], [{ name: "A", coordinates: [x, y] }])` with A spawned so that A owns the landmark tile (`conquer`) and both players have equal troops:
  - `landmarksHeldBy(A) === 1`, `landmarksHeldBy(B) === 0`.
  - After `executeNextTick()`, A's gold gain minus B's gold gain `=== LANDMARK_GOLD_PER_TICK`.
  - A's troop gain `> ` B's troop gain, and equals `config.troopIncreaseRate(A, 1)`.
  - A at `maxTroops` holding the landmark gains `0` troops.
  - After B conquers the landmark tile, the next tick gives the bonus to B and not to A.
  - With no landmarks (`setup` without the arg), per-tick gold/troop gain equals `goldAdditionRate` / `troopIncreaseRate(player)` exactly as before.
- [ ] **Step 2: Run** `npx vitest tests/core/LandmarkBonus.test.ts --run`. Expected: FAIL (`landmarksHeldBy` not a function).
- [ ] **Step 3: Implement**: constants and the `landmarksHeld` factor in `Config.troopIncreaseRate` (multiply `toAdd` before the clamp). `GameImpl` resolves each landmark to a `TileRef` once in its constructor. In `PlayerExecution.tick`: `const held = this.mg.landmarksHeldBy(this.player)`, pass `held` to `troopIncreaseRate`, add `LANDMARK_GOLD_PER_TICK * BigInt(held)` to the gold added and to `stats().goldWork`. Thread `landmarks` through `GameRunner` → `createGame` and through `Setup.ts`. Ownership is derived from tiles, so add no snapshot fields.
- [ ] **Step 4: Run** `npx vitest tests/core/LandmarkBonus.test.ts --run`. Expected: PASS.
- [ ] **Step 5: Run** `npm run test:changed` and `npm run typecheck`. Expected: PASS (other `createGame` callers compile unchanged because `landmarks` defaults to `[]`).
- [ ] **Step 6: Commit**

```bash
git add packages/engine-lib packages/engine tests/core/LandmarkBonus.test.ts tests/util/Setup.ts
git commit -m "feat: landmarks give gold and troop growth while held"
```

### Task 3: Client: landmark markers and info card

**Files:**
- Modify: `src/client/view/GameView.ts` (landmark accessors from `_mapData`)
- Modify: `src/client/hud/layers/ControlPanel.ts:154,342` (pass `game.landmarksHeldBy(player)` to `troopIncreaseRate`)
- Create: `src/client/hud/layers/LandmarkOverlay.ts` (`<landmark-overlay>`)
- Create: `resources/images/LandmarkIcon.svg` (original monument glyph, single path, `currentColor`)
- Modify: `index.html` (add `<landmark-overlay></landmark-overlay>` beside `<onboarding-overlay>`), `src/client/hud/GameRenderer.ts` (find, wire `game`/`transformHandler`, add to `layers` like `onboardingOverlay`)
- Modify: `resources/lang/en.json` (new `landmark` section)
- Test: `tests/client/LandmarkOverlay.test.ts`

**Interfaces:**
- Consumes: `TerrainMapData.landmarks` (Task 1), `LANDMARK_GOLD_PER_TICK`, `LANDMARK_TROOP_BONUS`, `Config.troopIncreaseRate(player, landmarksHeld)` (Task 2).
- Produces:
  - `GameView.landmarks(): readonly { name: string; x: number; y: number; tile: TileRef }[]`, `GameView.landmarkOwner(i: number): PlayerView | null`, `GameView.landmarksHeldBy(player: PlayerView): number`.
  - `LandmarkOverlay` (Lit, light DOM) implementing `Controller` with `game: GameView` and `transformHandler: TransformHandler` set by `GameRenderer`.
  - en.json keys: `landmark.owner` ("Owner: {name}"), `landmark.unclaimed` ("Unclaimed"), `landmark.gold_bonus` ("+{amount} gold / min"), `landmark.troop_bonus` ("+{percent}% troop growth"), `landmark.held_by_you` ("Held by you").

UI, matching the existing HUD (dark `bg-gray-900/95`, `rounded-xl`, `shadow-2xl`, white text, uppercase tracking headings, as in `OnboardingOverlay`/`PlayerInfoOverlay`):
- Marker: 28px round button centred on the tile, `bg-gray-900/85` with the icon, ring `border-2` in the owner's `territoryColor().toHex()` (white/30 when unclaimed); `pointer-events-auto` only on the marker. Markers whose screen position is off-screen are not rendered.
- Card: opens on hover (desktop) or tap (touch), above the marker; shows the name, owner line (`landmark.owner` / `landmark.unclaimed` / `landmark.held_by_you`), and both bonuses (gold = `LANDMARK_GOLD_PER_TICK * 600n` rendered with `renderNumber`, percent = `LANDMARK_TROOP_BONUS * 100`). A tap elsewhere closes it.
- Positions follow the camera with a `requestAnimationFrame` loop as `OnboardingOverlay.followTarget` does; ownership refreshes in `tick()`.

- [ ] **Step 1: Write failing tests** in `tests/client/LandmarkOverlay.test.ts` (jsdom), with a stub `game` (two landmarks, one owned by a stub player with `displayName()` "Alice" and `territoryColor()`) and a stub `transformHandler.worldToScreenCoordinates` returning fixed points (one off-screen):
  - renders exactly one marker (the on-screen one);
  - hovering the marker shows a card containing the landmark name, "Owner: Alice", "+15,000 gold / min", "+10% troop growth";
  - an unowned landmark's card shows "Unclaimed";
  - `GameView.landmarksHeldBy` counts only tiles owned by the given player (unit test against a `GameView` built from a test map with landmarks, or as a pure helper if `GameView` is impractical to construct).
- [ ] **Step 2: Run** `npx vitest tests/client/LandmarkOverlay.test.ts --run`. Expected: FAIL (element not defined).
- [ ] **Step 3: Implement** the `GameView` accessors, the overlay, the icon, the `index.html` / `GameRenderer` wiring, the `ControlPanel` change and the en.json keys.
- [ ] **Step 4: Run** `npx vitest tests/client/LandmarkOverlay.test.ts tests/TranslationSystem.test.ts --run`. Expected: PASS.
- [ ] **Step 5: Verify in the real app** with the `run-openfront` skill: start a solo game on **World**, screenshot the map with markers visible, hover one marker and screenshot the card, spawn next to a landmark, expand onto it, and confirm via `document.querySelector("build-menu").game` that `landmarksHeldBy(myPlayer())` is `1` and the control panel troop rate rose.
- [ ] **Step 6: Run** `npm run lint`, `npm run typecheck`, `npm run test:changed`. Expected: PASS.
- [ ] **Step 7: Commit**

```bash
git add src/client resources/images/LandmarkIcon.svg resources/lang/en.json index.html tests/client/LandmarkOverlay.test.ts
git commit -m "feat: landmark markers and info cards on the map"
```
