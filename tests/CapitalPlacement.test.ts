import {
  GameType,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

const gameID = "game_id";

async function spawned(
  config: Parameters<typeof setup>[1],
  type: PlayerType = PlayerType.Human,
): Promise<{ game: Game; player: Player; enemy: Player }> {
  const game = await setup("plains", config);
  const info = new PlayerInfo("p", type, null, "p");
  const enemyInfo = new PlayerInfo("e", PlayerType.Human, null, "e");
  game.addPlayer(info);
  game.addPlayer(enemyInfo);
  game.addExecution(
    new SpawnExecution(gameID, info, game.ref(20, 20)),
    new SpawnExecution(gameID, enemyInfo, game.ref(60, 60)),
  );
  executeTicks(game, 3);
  return { game, player: game.player("p"), enemy: game.player("e") };
}

function capitals(player: Player) {
  return player.units(UnitType.Capital);
}

describe("Capital placement", () => {
  test("places one tier-1 capital on the spawn tile after spawn phase", async () => {
    const { player } = await spawned({ capitals: true });
    expect(capitals(player)).toHaveLength(1);
    expect(capitals(player)[0].level()).toBe(1);
    expect(capitals(player)[0].tile()).toBe(player.spawnTile());
  });

  test("re-picked spawn: capital on the final spawn tile", async () => {
    const game = await setup(
      "plains",
      // Singleplayer ends the spawn phase on the first pick.
      { capitals: true, gameType: GameType.Public },
      [],
      undefined,
      undefined,
      false,
    );
    const info = new PlayerInfo("p", PlayerType.Human, null, "p");
    game.addPlayer(info);
    game.addExecution(new SpawnExecution(gameID, info, game.ref(20, 20)));
    executeTicks(game, 2);
    game.addExecution(new SpawnExecution(gameID, info, game.ref(70, 70)));
    executeTicks(game, 2);
    const player = game.player("p");
    expect(capitals(player)).toHaveLength(0);
    game.endSpawnPhase();
    executeTicks(game, 2);
    expect(capitals(player)).toHaveLength(1);
    expect(capitals(player)[0].tile()).toBe(player.spawnTile());
    expect(player.spawnTile()).toBe(game.ref(70, 70));
  });

  test("toggle off: no capital", async () => {
    const { player } = await spawned({});
    expect(capitals(player)).toHaveLength(0);
  });

  test("tribe: no capital", async () => {
    const { player } = await spawned({ capitals: true }, PlayerType.Bot);
    expect(capitals(player)).toHaveLength(0);
  });

  test("capture drops one tier and moves", async () => {
    const { game, player, enemy } = await spawned({ capitals: true });
    const capital = capitals(player)[0];
    capital.increaseLevel();
    capital.increaseLevel();
    const oldTile = capital.tile();
    enemy.conquer(oldTile);
    executeTicks(game, 1);
    expect(capitals(player)).toHaveLength(1);
    const moved = capitals(player)[0];
    expect(moved.level()).toBe(2);
    expect(moved.tile()).not.toBe(oldTile);
    expect(game.owner(moved.tile())).toBe(player);
    expect(capitals(enemy)).toHaveLength(1); // only its own
    expect(capitals(enemy)[0].tile()).toBe(enemy.spawnTile());
  });

  test("tier 1 capture moves without dropping", async () => {
    const { game, player, enemy } = await spawned({ capitals: true });
    enemy.conquer(capitals(player)[0].tile());
    executeTicks(game, 1);
    expect(capitals(player)).toHaveLength(1);
    expect(capitals(player)[0].level()).toBe(1);
  });

  test("last tile captured: no capital, no throw", async () => {
    const { game, player, enemy } = await spawned({ capitals: true });
    const capTile = capitals(player)[0].tile();
    for (const t of Array.from(player.tiles())) {
      if (t !== capTile) player.relinquish(t);
    }
    enemy.conquer(capTile);
    expect(() => executeTicks(game, 2)).not.toThrow();
    expect(player.isAlive()).toBe(false);
    expect(capitals(player)).toHaveLength(0);
  });

  test("tile left unowned (e.g. nuked): moves, keeps tier", async () => {
    const { game, player } = await spawned({ capitals: true });
    const capital = capitals(player)[0];
    capital.increaseLevel();
    const oldTile = capital.tile();
    player.relinquish(oldTile);
    executeTicks(game, 1);
    expect(capitals(player)).toHaveLength(1);
    expect(capitals(player)[0].level()).toBe(2);
    expect(capitals(player)[0].tile()).not.toBe(oldTile);
  });

  test("a captured capital moves away from the front, not next to it", async () => {
    const { game, player, enemy } = await spawned({ capitals: true });
    for (let x = 10; x <= 50; x++) {
      for (let y = 15; y <= 25; y++) player.conquer(game.ref(x, y));
    }
    executeTicks(game, 25); // let the cluster box catch up
    const lost = capitals(player)[0].tile();
    enemy.conquer(lost);
    executeTicks(game, 1);
    const moved = capitals(player)[0].tile();
    // The farthest owned tile from the lost one, so the push can't take it next.
    let farthest = 0;
    for (const t of player.tiles()) {
      farthest = Math.max(farthest, game.manhattanDist(t, lost));
    }
    expect(game.manhattanDist(moved, lost)).toBe(farthest);
  });

  test("tile left unowned mid-upgrade: the paid upgrade carries over", async () => {
    const { game, player } = await spawned({ capitals: true });
    const capital = capitals(player)[0];
    capital.startCapitalUpgrade();
    const landsAt = capital.capitalUpgradeAt();
    executeTicks(game, 100);
    player.relinquish(capital.tile());
    executeTicks(game, 1);
    expect(capitals(player)[0].capitalUpgradeAt()).toBe(landsAt);
    executeTicks(game, 200);
    expect(capitals(player)[0].level()).toBe(2);
  });
});
