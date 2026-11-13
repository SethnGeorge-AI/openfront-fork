import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { BuildMenu } from "../../src/client/hud/layers/BuildMenu";

function menuAtTier(tier: number, capitals = true): BuildMenu {
  const player = {
    type: () => PlayerType.Human,
    units: (t: UnitType) =>
      t === UnitType.Capital && tier > 0 ? [{ level: () => tier }] : [],
  };
  const menu = new BuildMenu();
  menu.game = {
    myPlayer: () => player,
    config: () => ({
      requiredTierFor: (type: UnitType) => {
        if (!capitals) return 0;
        const tiers: Partial<Record<UnitType, number>> = {
          [UnitType.Port]: 2,
          [UnitType.MIRV]: 5,
        };
        return tiers[type] ?? 0;
      },
    }),
  } as any;
  return menu;
}

describe("BuildMenu capital tiers", () => {
  test("a Port is locked behind tier 2 for a tier-1 player", () => {
    expect(menuAtTier(1).lockedTier(UnitType.Port)).toBe(2);
  });

  test("unlocked once the player reaches the tier", () => {
    expect(menuAtTier(2).lockedTier(UnitType.Port)).toBe(0);
    expect(menuAtTier(2).lockedTier(UnitType.MIRV)).toBe(5);
  });

  test("never locked with capitals off", () => {
    expect(menuAtTier(0, false).lockedTier(UnitType.MIRV)).toBe(0);
  });
});
