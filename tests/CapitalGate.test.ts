import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

async function spawned(
  config: Parameters<typeof setup>[1],
): Promise<{ game: Game; player: Player }> {
  const game = await setup("plains", {
    infiniteGold: true,
    instantBuild: true,
    ...config,
  });
  const info = new PlayerInfo("p", PlayerType.Human, null, "p");
  game.addPlayer(info);
  game.addExecution(new SpawnExecution("game_id", info, game.ref(20, 20)));
  executeTicks(game, 3);
  return { game, player: game.player("p") };
}

// Claim a patch 25 tiles from the capital: structures need 15 tiles spacing.
function buildTile(game: Game, player: Player) {
  for (let x = 43; x <= 47; x++) {
    for (let y = 18; y <= 22; y++) player.conquer(game.ref(x, y));
  }
  return game.ref(45, 20);
}

describe("Capital tier gate", () => {
  test("tier 1 builds City and DefensePost, not Port/SAM/Silo", async () => {
    const { game, player } = await spawned({ capitals: true });
    const t = buildTile(game, player);
    expect(player.canBuild(UnitType.City, t)).not.toBe(false);
    expect(player.canBuild(UnitType.DefensePost, t)).not.toBe(false);
    expect(player.canBuild(UnitType.SAMLauncher, t)).toBe(false);
    expect(player.canBuild(UnitType.MissileSilo, t)).toBe(false);
    expect(player.canBuild(UnitType.Factory, t)).toBe(false);
  });

  test("tier 3 unlocks SAM and Silo", async () => {
    const { game, player } = await spawned({ capitals: true });
    const capital = player.units(UnitType.Capital)[0];
    capital.increaseLevel();
    capital.increaseLevel();
    const t = buildTile(game, player);
    expect(player.canBuild(UnitType.SAMLauncher, t)).not.toBe(false);
    expect(player.canBuild(UnitType.MissileSilo, t)).not.toBe(false);
  });

  test("toggle off: SAM buildable with no capital", async () => {
    const { game, player } = await spawned({});
    expect(player.units(UnitType.Capital)).toHaveLength(0);
    expect(
      player.canBuild(UnitType.SAMLauncher, buildTile(game, player)),
    ).not.toBe(false);
  });

  test("captured structure above tier can't be upgraded", async () => {
    const { game, player } = await spawned({ capitals: true });
    const sam = player.buildUnit(
      UnitType.SAMLauncher,
      buildTile(game, player),
      {},
    );
    expect(player.canUpgradeUnit(sam)).toBe(false);
  });
});
