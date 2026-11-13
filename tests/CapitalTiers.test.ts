import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  capitalTierCost,
  requiredCapitalTier,
} from "@openfront/engine-lib/configuration/CapitalTiers";
import { setup } from "./util/Setup";

describe("Capital tiers", () => {
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
    expect(requiredCapitalTier(UnitType.Capital)).toBe(0);
  });

  test("tier costs", () => {
    expect(capitalTierCost(1)).toBe(0n);
    expect(capitalTierCost(2)).toBe(250_000n);
    expect(capitalTierCost(3)).toBe(750_000n);
    expect(capitalTierCost(4)).toBe(2_000_000n);
    expect(capitalTierCost(5)).toBe(5_000_000n);
    expect(capitalTierCost(6)).toBe(0n);
  });

  test("toggle off: nothing gated", async () => {
    const game = await setup("plains", {});
    const p = game.addPlayer(new PlayerInfo("p", PlayerType.Human, null, "p"));
    expect(game.config().capitalsEnabled()).toBe(false);
    // Hides the Capital entry from build menus when the toggle is off.
    expect(game.config().isUnitDisabled(UnitType.Capital)).toBe(true);
    expect(game.config().requiredTierFor(UnitType.MIRV, p)).toBe(0);
  });

  test("toggle on: humans gated, tribes never", async () => {
    const game = await setup("plains", { capitals: true });
    const p = game.addPlayer(new PlayerInfo("p", PlayerType.Human, null, "p"));
    const bot = game.addPlayer(new PlayerInfo("b", PlayerType.Bot, null, "b"));
    expect(game.config().requiredTierFor(UnitType.MIRV, p)).toBe(5);
    expect(game.config().isUnitDisabled(UnitType.Capital)).toBe(false);
    expect(game.config().requiredTierFor(UnitType.MIRV, bot)).toBe(0);
  });
});
