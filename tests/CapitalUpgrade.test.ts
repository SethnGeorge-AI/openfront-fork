import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { genTerrainFromBin } from "@openfront/engine-lib/game/TerrainMapLoader";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { UpgradeStructureExecution } from "@openfront/engine/execution/UpgradeStructureExecution";
import { Game, Player, Unit } from "@openfront/engine/game/Game";
import {
  restoreGame,
  snapshotGame,
} from "@openfront/engine/snapshot/GameSnapshot";
import fs from "fs";
import path from "path";
import { setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";
import { executeTicks } from "./util/utils";

async function spawned(): Promise<{
  game: Game;
  player: Player;
  enemy: Player;
  capital: () => Unit;
}> {
  const game = await setup("plains", { capitals: true, instantBuild: true });
  const info = new PlayerInfo("p", PlayerType.Human, null, "p");
  const enemyInfo = new PlayerInfo("e", PlayerType.Human, null, "e");
  game.addPlayer(info);
  game.addPlayer(enemyInfo);
  game.addExecution(
    new SpawnExecution("game_id", info, game.ref(20, 20)),
    new SpawnExecution("game_id", enemyInfo, game.ref(60, 60)),
  );
  executeTicks(game, 3);
  const player = game.player("p");
  return {
    game,
    player,
    enemy: game.player("e"),
    capital: () => player.units(UnitType.Capital)[0],
  };
}

function upgrade(game: Game, player: Player, unit: Unit) {
  game.addExecution(new UpgradeStructureExecution(player, unit.id()));
}

describe("Capital timed upgrade", () => {
  test("costs gold now and lands after 300 ticks", async () => {
    const { game, player, capital } = await spawned();
    player.addGold(250_000n);
    const before = player.gold();
    upgrade(game, player, capital());
    executeTicks(game, 1);
    expect(before - player.gold()).toBeGreaterThanOrEqual(250_000n - 1000n);
    expect(capital().level()).toBe(1);
    expect(capital().capitalUpgradeAt()).not.toBeNull();
    executeTicks(game, 298);
    expect(capital().level()).toBe(1);
    executeTicks(game, 2);
    expect(capital().level()).toBe(2);
    expect(capital().capitalUpgradeAt()).toBeNull();
  });

  test("old tier holds during the upgrade", async () => {
    const { game, player, capital } = await spawned();
    player.addGold(10_000_000n);
    upgrade(game, player, capital());
    executeTicks(game, 150);
    expect(player.canUpgradeUnit(capital())).toBe(false); // one at a time
    expect(game.config().requiredTierFor(UnitType.Port, player)).toBe(2);
    expect(capital().level()).toBe(1);
  });

  test("second upgrade while pending charges nothing", async () => {
    const { game, player, capital } = await spawned();
    player.addGold(10_000_000n);
    upgrade(game, player, capital());
    executeTicks(game, 1);
    const mid = player.gold();
    upgrade(game, player, capital());
    executeTicks(game, 1);
    expect(player.gold()).toBeGreaterThanOrEqual(mid);
  });

  test("no upgrade past tier 5", async () => {
    const { player, capital } = await spawned();
    player.addGold(100_000_000n);
    for (let i = 0; i < 4; i++) capital().increaseLevel();
    expect(capital().level()).toBe(5);
    expect(player.canUpgradeUnit(capital())).toBe(false);
  });

  test("captured mid-upgrade: no refund, drops from old tier", async () => {
    const { game, player, enemy, capital } = await spawned();
    capital().increaseLevel();
    capital().increaseLevel();
    player.addGold(2_000_000n);
    upgrade(game, player, capital());
    executeTicks(game, 150);
    const gold = player.gold();
    enemy.conquer(capital().tile());
    executeTicks(game, 1);
    expect(capital().level()).toBe(2);
    expect(capital().capitalUpgradeAt()).toBeNull();
    expect(player.gold() - gold).toBeLessThan(1_000_000n);
    executeTicks(game, 200);
    expect(capital().level()).toBe(2);
  });

  test("snapshot round-trip keeps the pending upgrade", async () => {
    const { game, player, capital } = await spawned();
    player.addGold(250_000n);
    upgrade(game, player, capital());
    executeTicks(game, 100);
    const dir = path.join(__dirname, "testdata/maps/plains");
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
      landmarks: [],
    });
    const cap = () => restored.player("p").units(UnitType.Capital)[0];
    expect(cap().capitalUpgradeAt()).toBe(capital().capitalUpgradeAt());
    executeTicks(restored, 201);
    expect(cap().level()).toBe(2);
  });
});
