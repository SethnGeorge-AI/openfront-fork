import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { structureAtlasPng } from "../../scripts/genStructureAtlas";
import { PIXEL_PALETTE } from "../../src/client/hud/pixelArt";
import {
  STRUCTURE_ART,
  STRUCTURE_ART_ORDER,
  structureIconUrl,
} from "../../src/client/hud/structureArt";
import {
  UT_CAPITAL,
  UT_CITY,
  UT_DEFENSE_POST,
  UT_FACTORY,
  UT_MISSILE_SILO,
  UT_PORT,
  UT_SAM_LAUNCHER,
} from "../../src/client/render/types/UnitType";

describe("structure pixel art", () => {
  it("covers every structure, in the map atlas's column order", () => {
    expect(STRUCTURE_ART_ORDER).toEqual([
      UT_CITY,
      UT_PORT,
      UT_FACTORY,
      UT_DEFENSE_POST,
      UT_SAM_LAUNCHER,
      UT_MISSILE_SILO,
      UT_CAPITAL,
    ]);
    expect(Object.keys(STRUCTURE_ART).sort()).toEqual(
      [...STRUCTURE_ART_ORDER].sort(),
    );
  });

  it.each(Object.entries(STRUCTURE_ART))(
    "%s is a 32x32 grid of palette colours with an owner accent",
    (_name, rows) => {
      expect(rows).toHaveLength(32);
      for (const row of rows) {
        expect(row).toHaveLength(32);
        for (const ch of row) {
          expect(
            ch === "." || ch === "F" || ch === "f" || ch in PIXEL_PALETTE,
          ).toBe(true);
        }
      }
      // The accent is what shows the owner on the map.
      expect(rows.join("")).toMatch(/[Ff]/);
    },
  );

  it("gives each structure an inline SVG icon", () => {
    for (const type of STRUCTURE_ART_ORDER) {
      expect(structureIconUrl(type)).toMatch(/^data:image\/svg\+xml,/);
    }
  });

  it("the committed map atlas matches the art (run scripts/genStructureAtlas.ts)", () => {
    const committed = fs.readFileSync(
      path.join(__dirname, "../../resources/atlases/icon-atlas.png"),
    );
    expect(committed.equals(structureAtlasPng())).toBe(true);
  });
});
