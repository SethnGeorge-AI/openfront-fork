import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { defenderHasDefenseNearby } from "@openfront/engine/execution/AttackExecution";
import { DeleteUnitExecution } from "@openfront/engine/execution/DeleteUnitExecution";
import { NukeExecution } from "@openfront/engine/execution/NukeExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { Game, Player, Unit } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

async function spawned(): Promise<{
  game: Game;
  player: Player;
  enemy: Player;
  capital: () => Unit;
}> {
  const game = await setup("plains", {
    capitals: true,
    instantBuild: true,
    infiniteGold: true,
  });
  const info = new PlayerInfo("p", PlayerType.Human, null, "p");
  const enemyInfo = new PlayerInfo("e", PlayerType.Human, null, "e");
  game.addPlayer(info);
  game.addPlayer(enemyInfo);
  game.addExecution(
    new SpawnExecution("game_id", info, game.ref(20, 20)),
    new SpawnExecution("game_id", enemyInfo, game.ref(80, 80)),
  );
  executeTicks(game, 3);
  const player = game.player("p");
  // Tier 4 enemy, so its nukes pass the tier gate.
  const enemyCap = game.player("e").units(UnitType.Capital)[0];
  for (let i = 0; i < 3; i++) enemyCap.increaseLevel();
  executeTicks(game, 60); // past spawn immunity
  return {
    game,
    player,
    enemy: game.player("e"),
    capital: () => player.units(UnitType.Capital)[0],
  };
}

describe("Capital defenses", () => {
  test("SAM range is 15% over a SAM of the same level, capped", async () => {
    const { game, capital } = await spawned();
    const config = game.config();
    expect(config.dynamicSamRange(capital(), game.ticks())).toBe(
      Math.floor(config.samRange(1) * 1.15),
    );
    for (let i = 0; i < 4; i++) capital().increaseLevel();
    expect(config.dynamicSamRange(capital(), game.ticks())).toBeLessThanOrEqual(
      config.maxSamRange(),
    );
  });

  test("capital reloads in 1 tick, a SAM in 90", async () => {
    const { game } = await spawned();
    expect(game.config().samCooldownFor(UnitType.Capital)).toBe(1);
    expect(game.config().samCooldownFor(UnitType.SAMLauncher)).toBe(90);
  });

  test("tier-1 capital shoots down nukes launched back to back", async () => {
    const { game, player, enemy, capital } = await spawned();
    // One silo per nuke: a silo also needs 90 ticks to reload.
    for (const t of Array.from(enemy.tiles()).slice(0, 3)) {
      enemy.buildUnit(UnitType.MissileSilo, t, {});
    }
    const target = capital().tile();
    const city = player.buildUnit(
      UnitType.City,
      game.ref(game.x(target) - 1, game.y(target)),
      {},
    );
    for (let i = 0; i < 3; i++) {
      game.addExecution(
        new NukeExecution(UnitType.AtomBomb, enemy, target, null),
      );
      executeTicks(game, 10);
    }
    expect(game.units(UnitType.AtomBomb).length).toBeGreaterThan(0);
    executeTicks(game, 200);
    expect(game.units(UnitType.AtomBomb)).toHaveLength(0);
    expect(city.isActive()).toBe(true); // no nuke landed
    expect(capital().isActive()).toBe(true);
  });

  test("a nuke does not destroy the capital", async () => {
    const { game, player, capital } = await spawned();
    const cap = capital();
    cap.increaseLevel();
    cap.increaseLevel(); // tier 3: may launch atom bombs
    // The player nukes their own capital: SAMs ignore friendly nukes, so the
    // blast is guaranteed to land.
    const siloTile = game.ref(game.x(cap.tile()) + 4, game.y(cap.tile()));
    player.conquer(siloTile);
    player.buildUnit(UnitType.MissileSilo, siloTile, {});
    const city = player.buildUnit(
      UnitType.City,
      game.ref(game.x(cap.tile()) - 1, game.y(cap.tile())),
      {},
    );
    game.addExecution(
      new NukeExecution(UnitType.AtomBomb, player, cap.tile(), siloTile),
    );
    executeTicks(game, 60);
    expect(city.isActive()).toBe(false); // it went off
    // The blast may clear the tile; the capital then moves, keeping its tier.
    const caps = player.units(UnitType.Capital);
    expect(caps).toHaveLength(1);
    expect(caps[0].level()).toBe(3);
    expect(player.units(UnitType.Capital)).toHaveLength(1);
  });

  test("defense bonus within 35 tiles of the capital", async () => {
    const { game, player, capital } = await spawned();
    const cap = capital().tile();
    const near = game.ref(game.x(cap) + 33, game.y(cap));
    const far = game.ref(game.x(cap) + 40, game.y(cap));
    expect(defenderHasDefenseNearby(game, near, player)).toBe(true);
    expect(defenderHasDefenseNearby(game, far, player)).toBe(false);
  });

  test("cannot delete own capital", async () => {
    const { game, player, capital } = await spawned();
    const cap = capital();
    const city = player.buildUnit(UnitType.City, cap.tile(), {});
    game.addExecution(new DeleteUnitExecution(player, cap.id()));
    executeTicks(game, 5);
    expect(cap.isActive()).toBe(true);
    // The same path does delete an ordinary structure.
    executeTicks(game, game.config().deleteUnitCooldown());
    game.addExecution(new DeleteUnitExecution(player, city.id()));
    executeTicks(game, 5);
    expect(city.isMarkedForDeletion() || !city.isActive()).toBe(true);
  });

  test("capitals off: attacks don't look for a capital", async () => {
    const game = await setup("plains", {});
    const p = game.addPlayer(new PlayerInfo("p", PlayerType.Human, null, "p"));
    const spy = vi.spyOn(game, "hasUnitNearby");
    defenderHasDefenseNearby(game, game.ref(5, 5), p);
    const types = spy.mock.calls.map((c) => c[2]);
    expect(types).not.toContain(UnitType.Capital);
  });
});
