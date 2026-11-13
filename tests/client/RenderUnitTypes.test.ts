import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { ALL_UNIT_TYPES } from "../../src/client/render/types/UnitType";

test("the renderer knows every engine unit type", () => {
  // A type missing here gets no atlas column, so the renderer never draws it.
  for (const t of Object.values(UnitType)) {
    expect(ALL_UNIT_TYPES as readonly string[]).toContain(t);
  }
});
