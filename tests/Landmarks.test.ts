import { GameMapSize, GameMapType } from "@openfront/engine-api/game/GameTypes";
import type { Landmark, MapFiles } from "@openfront/engine-api/game/MapFiles";
import {
  genTerrainFromBin,
  loadTerrainMap,
} from "@openfront/engine-lib/game/TerrainMapLoader";
import fs from "fs";
import path from "path";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..");

/** A map whose tiles are all land except those listed as water. */
function makeFiles(
  landmarks: Landmark[],
  mapSize: GameMapSize,
  water: [number, number][] = [],
): MapFiles {
  const bin = (w: number, h: number, scale: number) => {
    const b = new Uint8Array(w * h).fill(0x80);
    for (const [x, y] of water)
      b[Math.floor(y / scale) * w + Math.floor(x / scale)] = 0;
    return b;
  };
  const meta = (w: number, h: number) => ({
    width: w,
    height: h,
    num_land_tiles: w * h,
  });
  return {
    map: GameMapType.World,
    mapSize,
    manifest: {
      name: "test",
      map: meta(16, 16),
      map4x: meta(8, 8),
      map16x: meta(4, 4),
      nations: [],
      landmarks,
    } as never,
    mapBin: bin(16, 16, 1),
    map4xBin: bin(8, 8, 2),
    map16xBin: bin(4, 4, 4),
  };
}

describe("loadTerrainMap landmarks", () => {
  test("returns no landmarks when the manifest has none", async () => {
    const files = makeFiles([], GameMapSize.Normal);
    delete (files.manifest as { landmarks?: unknown }).landmarks;
    expect((await loadTerrainMap(files)).landmarks).toEqual([]);
  });

  test("keeps coordinates on a normal map", async () => {
    const data = await loadTerrainMap(
      makeFiles([{ name: "A", coordinates: [10, 10] }], GameMapSize.Normal),
    );
    expect(data.landmarks).toEqual([{ name: "A", coordinates: [10, 10] }]);
  });

  test("halves coordinates on a compact map", async () => {
    const data = await loadTerrainMap(
      makeFiles([{ name: "A", coordinates: [11, 10] }], GameMapSize.Compact),
    );
    expect(data.landmarks[0].coordinates).toEqual([5, 5]);
  });

  test("rejects two landmarks that share a tile on a compact map", async () => {
    await expect(
      loadTerrainMap(
        makeFiles(
          [
            { name: "A", coordinates: [10, 10] },
            { name: "B", coordinates: [11, 11] },
          ],
          GameMapSize.Compact,
        ),
      ),
    ).rejects.toThrow('landmarks "A" and "B" share a tile');
  });

  test("rejects a landmark on water", async () => {
    await expect(
      loadTerrainMap(
        makeFiles([{ name: "Sunk", coordinates: [3, 4] }], GameMapSize.Normal, [
          [3, 4],
        ]),
      ),
    ).rejects.toThrow('landmark "Sunk" is not on land');
  });
});

const LANDMARK_MAPS = [
  "world",
  "europe",
  "asia",
  "africa",
  "northamerica",
  "southamerica",
  "australia",
];

describe.each(LANDMARK_MAPS)("%s landmarks", (map) => {
  const read = (p: string) =>
    JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
  const info = read(`map-generator/assets/maps/${map}/info.json`);
  const manifest = read(`resources/maps/${map}/manifest.json`);
  const landmarks: Landmark[] = manifest.landmarks ?? [];

  test("info.json and manifest.json list the same landmarks", () => {
    expect(info.landmarks).toEqual(manifest.landmarks);
  });

  test("has at least 8 landmarks", () => {
    expect(landmarks.length).toBeGreaterThanOrEqual(8);
  });

  test("every landmark is on land at normal and compact size", async () => {
    const bin = (f: string) =>
      new Uint8Array(
        fs.readFileSync(path.join(ROOT, `resources/maps/${map}/${f}`)),
      );
    const normal = await genTerrainFromBin(manifest.map, bin("map.bin"));
    const compact = await genTerrainFromBin(manifest.map4x, bin("map4x.bin"));
    const water: string[] = [];
    for (const {
      name,
      coordinates: [x, y],
    } of landmarks) {
      if (!normal.isLand(normal.ref(x, y))) water.push(`${name} (normal)`);
      const [cx, cy] = [Math.floor(x / 2), Math.floor(y / 2)];
      if (!compact.isLand(compact.ref(cx, cy))) water.push(`${name} (compact)`);
    }
    expect(water).toEqual([]);
  });

  test("no two landmarks share a tile at compact size", () => {
    const compact = landmarks.map(({ coordinates: [x, y] }) =>
      [Math.floor(x / 2), Math.floor(y / 2)].join(","),
    );
    expect(new Set(compact).size).toBe(compact.length);
  });
});
