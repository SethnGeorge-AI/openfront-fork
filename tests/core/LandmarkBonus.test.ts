import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import type { Landmark } from "@openfront/engine-api/game/MapFiles";
import { GOLD_INDEX_WORK } from "@openfront/engine-api/StatsSchemas";
import {
  LANDMARK_GOLD_PER_TICK,
  LANDMARK_TROOP_BONUS,
} from "@openfront/engine-lib/configuration/Config";
import { genTerrainFromBin } from "@openfront/engine-lib/game/TerrainMapLoader";
import { PlayerExecution } from "@openfront/engine/execution/PlayerExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import {
  restoreGame,
  snapshotGame,
} from "@openfront/engine/snapshot/GameSnapshot";
import fs from "fs";
import path from "path";
import { setup } from "../util/Setup";
import { TestConfig } from "../util/TestConfig";

const LANDMARK: Landmark = { name: "Test Tower", coordinates: [10, 10] };

async function twoPlayers(landmarks?: Landmark[]) {
  const game = await setup(
    "plains",
    {},
    [
      new PlayerInfo("a", PlayerType.Human, "a_client", "a_id"),
      new PlayerInfo("b", PlayerType.Human, "b_client", "b_id"),
    ],
    __dirname,
    TestConfig,
    true,
    [],
    landmarks,
  );
  const a = game.player("a_id");
  const b = game.player("b_id");
  a.conquer(game.ref(10, 10));
  a.conquer(game.ref(11, 10));
  b.conquer(game.ref(60, 60));
  a.setTroops(10_000);
  b.setTroops(10_000);
  game.addExecution(new PlayerExecution(a), new PlayerExecution(b));
  game.executeNextTick(); // executions init
  return { game, a, b };
}

/** Gold and troops each player gains over one tick. */
function gains(game: Game, players: Player[]) {
  const before = players.map((p) => ({ gold: p.gold(), troops: p.troops() }));
  game.executeNextTick();
  return players.map((p, i) => ({
    gold: p.gold() - before[i].gold,
    troops: p.troops() - before[i].troops,
  }));
}

describe("landmark bonus", () => {
  test("only the owner of the landmark tile holds it", async () => {
    const { game, a, b } = await twoPlayers([LANDMARK]);
    expect(game.landmarks().map((l) => l.name)).toEqual(["Test Tower"]);
    expect(game.landmarksHeldBy(a)).toBe(1);
    expect(game.landmarksHeldBy(b)).toBe(0);
  });

  test("the holder earns LANDMARK_GOLD_PER_TICK more gold per tick", async () => {
    const { game, a, b } = await twoPlayers([LANDMARK]);
    a.setTroops(b.troops());
    const [ga, gb] = gains(game, [a, b]);
    expect(ga.gold - gb.gold).toBe(LANDMARK_GOLD_PER_TICK);
  });

  test("the holder's troops grow faster, by troopIncreaseRate(player, 1)", async () => {
    const { game, a, b } = await twoPlayers([LANDMARK]);
    a.setTroops(10_000);
    b.setTroops(10_000);
    const expected = game.config().troopIncreaseRate(a, 1);
    expect(expected).toBeGreaterThan(game.config().troopIncreaseRate(a));
    const [ga, gb] = gains(game, [a, b]);
    // Troops are whole numbers: the rate is applied rounded.
    expect(Math.abs(ga.troops - expected)).toBeLessThan(1);
    expect(ga.troops).toBeGreaterThan(gb.troops);
  });

  test("the bonus factor is 1 + LANDMARK_TROOP_BONUS per landmark", async () => {
    const { game, a } = await twoPlayers([LANDMARK]);
    // Far below max troops the clamp never binds, so the ratio is exact.
    a.setTroops(1_000);
    const config = game.config();
    expect(
      config.troopIncreaseRate(a, 2) / config.troopIncreaseRate(a),
    ).toBeCloseTo(1 + 2 * LANDMARK_TROOP_BONUS, 6);
  });

  test("landmarks do not speed up the decay of troops over the cap", async () => {
    const { game, a } = await twoPlayers([LANDMARK]);
    const config = game.config();
    a.setTroops(Math.floor(config.maxTroops(a) * 1.5));
    const decay = config.troopIncreaseRate(a);
    expect(decay).toBeLessThan(0);
    expect(config.troopIncreaseRate(a, 3)).toBe(decay);
  });

  test("landmark gold is not counted as worker gold in the stats", async () => {
    const { game, a } = await twoPlayers([LANDMARK]);
    const work = () =>
      game.stats().getPlayerStats(a)?.gold?.[GOLD_INDEX_WORK] ?? 0n;
    const before = work();
    const base = game.config().goldAdditionRate(a);
    gains(game, [a]);
    expect(work() - before).toBe(base);
  });

  test("a holder at max troops gains no troops", async () => {
    const { game, a } = await twoPlayers([LANDMARK]);
    a.setTroops(game.config().maxTroops(a));
    const [ga] = gains(game, [a]);
    expect(ga.troops).toBe(0);
  });

  test("losing the tile moves the bonus to the new owner that tick", async () => {
    const { game, a, b } = await twoPlayers([LANDMARK]);
    b.conquer(game.ref(10, 10));
    expect(game.landmarksHeldBy(a)).toBe(0);
    expect(game.landmarksHeldBy(b)).toBe(1);
    a.setTroops(b.troops());
    const [ga, gb] = gains(game, [a, b]);
    expect(gb.gold - ga.gold).toBe(LANDMARK_GOLD_PER_TICK);
  });

  test("a game without landmarks pays the base rates", async () => {
    const { game, a } = await twoPlayers();
    expect(game.landmarks()).toEqual([]);
    const config = game.config();
    const gold = config.goldAdditionRate(a);
    const troops = config.troopIncreaseRate(a);
    const [ga] = gains(game, [a]);
    expect(ga.gold).toBe(gold);
    expect(Math.abs(ga.troops - troops)).toBeLessThan(1);
  });

  test("a game restored from a snapshot keeps its landmarks", async () => {
    const { game } = await twoPlayers([LANDMARK]);
    const dir = path.join(__dirname, "../testdata/maps/plains");
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
    );
    const restored = restoreGame(snapshotGame(game), {
      config: (gc) => new TestConfig(gc, false),
      gameMap: await genTerrainFromBin(
        manifest.map,
        fs.readFileSync(path.join(dir, "map.bin")),
      ),
      miniGameMap: await genTerrainFromBin(
        manifest.map4x,
        fs.readFileSync(path.join(dir, "map4x.bin")),
      ),
      landmarks: [LANDMARK],
    });
    expect(restored.landmarksHeldBy(restored.player("a_id"))).toBe(1);
  });
});
