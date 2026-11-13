// @vitest-environment jsdom
import {
  Cosmetics,
  CosmeticsSchema,
  FREE_COSMETIC_FLARES,
} from "@openfront/shared/CosmeticSchemas";
import { decodePatternData } from "@openfront/shared/PatternDecoder";
import fs from "fs";
import { base64url } from "jose";
import path from "path";
import {
  fetchCosmetics,
  invalidateCosmetics,
  resolveCosmetics,
} from "../src/client/Cosmetics";
import { PrivilegeCheckerImpl } from "../src/server/Privilege";

// This fork gives every cosmetic away, from its own catalog.
const catalog = CosmeticsSchema.parse(
  JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../resources/cosmetics/catalog.json"),
      "utf8",
    ),
  ),
) as Cosmetics;

describe("free cosmetics", () => {
  it("ships a catalog whose patterns all decode", () => {
    const patterns = Object.values(catalog.patterns);
    expect(patterns.length).toBeGreaterThan(0);
    for (const pattern of patterns) {
      expect(() =>
        decodePatternData(pattern.pattern, base64url.decode),
      ).not.toThrow();
      for (const palette of pattern.colorPalettes ?? []) {
        expect(catalog.colorPalettes?.[palette.name]).toBeDefined();
      }
    }
  });

  it("fetches the bundled catalog from this server", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(catalog)));
    invalidateCosmetics();
    expect(await fetchCosmetics()).not.toBeNull();
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(
      /\/cosmetics\/catalog(\.[0-9a-f]+)?\.json$/,
    );
    fetchSpy.mockRestore();
  });

  it("gives a signed-out player every catalog item", () => {
    const items = resolveCosmetics(catalog, false, null);
    expect(items.length).toBeGreaterThan(1);
    expect(items.every((item) => item.relationship === "owned")).toBe(true);
  });

  it("lets the server accept any catalog pattern and palette", () => {
    const checker = new PrivilegeCheckerImpl(
      catalog,
      base64url.decode,
      new Set(),
    );
    for (const pattern of Object.values(catalog.patterns)) {
      for (const palette of pattern.colorPalettes ?? []) {
        const result = checker.isAllowed(FREE_COSMETIC_FLARES, {
          patternName: pattern.name,
          patternColorPaletteName: palette.name,
        });
        expect(result.type).toBe("allowed");
      }
    }
  });
});
