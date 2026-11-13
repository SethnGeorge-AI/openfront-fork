import {
  Difficulty,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { placeCapital } from "@openfront/engine/execution/CapitalPlacement";
import { NationStructureBehavior } from "@openfront/engine/execution/nation/NationStructureBehavior";
import { UpgradeStructureExecution } from "@openfront/engine/execution/UpgradeStructureExecution";
import { createGame, L } from "./core/pathfinding/_fixtures";

function setupNation(tier: number, cities: number) {
  const size = 100;
  const game = createGame(
    { width: size, height: size, grid: new Array(size * size).fill(L) },
    { difficulty: Difficulty.Medium, capitals: true },
  );
  const nation = game.addPlayer(
    new PlayerInfo("nation", PlayerType.Nation, null, "nation_id"),
  );
  game.map().forEachTile((t) => nation.conquer(t));
  const capital = placeCapital(game, nation, tier, game.ref(50, 50))!;
  for (let i = 0; i < cities; i++) {
    nation.buildUnit(UnitType.City, game.ref(5, 10 + 20 * i), {});
  }
  const behavior = new NationStructureBehavior(
    new PseudoRandom(7),
    game,
    nation,
  );
  const spy = vi.spyOn(game, "addExecution");
  const upgradedCapital = () =>
    spy.mock.calls
      .map((c) => c[0])
      .some(
        (e) =>
          e instanceof UpgradeStructureExecution &&
          e["unitId"] === capital.id(),
      );
  return { nation, behavior, upgradedCapital };
}

describe("Nations and their capital", () => {
  test("upgrades the capital when it can pay and has the cities", () => {
    const { nation, behavior, upgradedCapital } = setupNation(1, 1);
    nation.addGold(1_000_000n);
    behavior.handleStructures();
    expect(upgradedCapital()).toBe(true);
  });

  test("builds cities first when it has fewer cities than its tier", () => {
    const { nation, behavior, upgradedCapital } = setupNation(2, 1);
    nation.addGold(10_000_000n);
    behavior.handleStructures();
    expect(upgradedCapital()).toBe(false);
  });

  test("does not upgrade when it can't pay", () => {
    const { nation, behavior, upgradedCapital } = setupNation(1, 1);
    nation.removeGold(nation.gold());
    nation.addGold(100_000n);
    behavior.handleStructures();
    expect(upgradedCapital()).toBe(false);
  });
});
