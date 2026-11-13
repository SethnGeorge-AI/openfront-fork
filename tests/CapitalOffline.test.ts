import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  capitalGoldMultiplierPct,
  capitalTroopMultiplier,
} from "@openfront/engine-lib/configuration/CapitalTiers";
import { NukeExecution } from "@openfront/engine/execution/NukeExecution";
import { PortExecution } from "@openfront/engine/execution/PortExecution";
import { SAMLauncherExecution } from "@openfront/engine/execution/SAMLauncherExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { Game, Player, Unit } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

async function spawned(
  config: Parameters<typeof setup>[1] = { capitals: true },
): Promise<{
  game: Game;
  player: Player;
  enemy: Player;
  capital: () => Unit;
}> {
  const game = await setup("plains", {
    instantBuild: true,
    infiniteGold: true,
    ...config,
  });
  const info = new PlayerInfo("p", PlayerType.Human, null, "p");
  const enemyInfo = new PlayerInfo("e", PlayerType.Human, null, "e");
  game.addPlayer(info);
  game.addPlayer(enemyInfo);
  game.addExecution(
    new SpawnExecution("game_id", info, game.ref(20, 20)),
    new SpawnExecution("game_id", enemyInfo, game.ref(80, 80)),
  );
  executeTicks(game, 60); // past spawn immunity
  const player = game.player("p");
  return {
    game,
    player,
    enemy: game.player("e"),
    capital: () => player.units(UnitType.Capital)[0],
  };
}

// A patch of the player's land far outside the capital's own SAM range.
function farPatch(game: Game, player: Player): number {
  for (let x = 58; x <= 62; x++) {
    for (let y = 18; y <= 22; y++) player.conquer(game.ref(x, y));
  }
  return game.ref(60, 20);
}

describe("Offline structures", () => {
  test("a SAM above the owner's tier is offline until they climb back", async () => {
    const { game, player, capital } = await spawned();
    const sam = player.buildUnit(
      UnitType.SAMLauncher,
      farPatch(game, player),
      {},
    );
    expect(game.config().isStructureOffline(sam)).toBe(true); // tier 1
    capital().increaseLevel();
    capital().increaseLevel();
    expect(game.config().isStructureOffline(sam)).toBe(false); // tier 3
  });

  test("an offline SAM does not intercept", async () => {
    const { game, player, enemy } = await spawned();
    const enemyCap = enemy.units(UnitType.Capital)[0];
    for (let i = 0; i < 3; i++) enemyCap.increaseLevel();
    enemy.buildUnit(UnitType.MissileSilo, enemy.spawnTile()!, {});
    const tile = farPatch(game, player);
    const sam = player.buildUnit(UnitType.SAMLauncher, tile, {});
    game.addExecution(new SAMLauncherExecution(player, null, sam));
    const city = player.buildUnit(
      UnitType.City,
      game.ref(game.x(tile) + 1, game.y(tile)),
      {},
    );
    game.addExecution(new NukeExecution(UnitType.AtomBomb, enemy, tile, null));
    executeTicks(game, 200);
    expect(game.config().isStructureOffline(sam)).toBe(true);
    expect(city.isActive()).toBe(false); // the nuke got through
  });

  test("a captured SAM is offline for a tier-1 captor", async () => {
    const { game, player, enemy } = await spawned();
    const tile = farPatch(game, player);
    const sam = enemy.buildUnit(UnitType.SAMLauncher, tile, {});
    expect(sam.owner()).toBe(enemy);
    expect(game.config().isStructureOffline(sam)).toBe(true);
    expect(player).toBeDefined();
  });

  test("an offline port spawns no trade ships", async () => {
    const { game, player } = await spawned();
    const port = player.buildUnit(UnitType.Port, farPatch(game, player), {});
    const exec = new PortExecution(port);
    exec.init(game, game.ticks());
    for (let i = 0; i < 200; i++) {
      expect(exec.shouldSpawnTradeShip()).toBe(false);
    }
  });

  test("toggle off: nothing is offline", async () => {
    const { game, player } = await spawned({});
    const sam = player.buildUnit(
      UnitType.SAMLauncher,
      farPatch(game, player),
      {},
    );
    expect(game.config().isStructureOffline(sam)).toBe(false);
  });
});

describe("Tier economy", () => {
  test("multipliers", () => {
    expect(capitalGoldMultiplierPct(0)).toBe(100);
    expect(capitalGoldMultiplierPct(1)).toBe(100);
    expect(capitalGoldMultiplierPct(3)).toBe(120);
    expect(capitalTroopMultiplier(1)).toBe(1);
    expect(capitalTroopMultiplier(5)).toBe(1.2);
  });

  test("a tier-3 player earns 120% gold per tick", async () => {
    const { game, player, capital } = await spawned();
    const base = game.config().goldAdditionRate(player);
    capital().increaseLevel();
    capital().increaseLevel();
    expect(game.config().goldAdditionRate(player)).toBe((base * 120n) / 100n);
  });
});
