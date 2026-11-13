import fs from "fs";
import { render } from "lit";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  LANDMARK_ART,
  LANDMARK_PALETTE,
  landmarkArt,
} from "../../src/client/hud/landmarkArt";

const MAPS = [
  "world",
  "europe",
  "asia",
  "africa",
  "northamerica",
  "southamerica",
  "australia",
];

const names = new Set(
  MAPS.flatMap((m) =>
    (
      JSON.parse(
        fs.readFileSync(
          path.join(__dirname, `../../resources/maps/${m}/manifest.json`),
          "utf8",
        ),
      ).landmarks as { name: string }[]
    ).map((l) => l.name),
  ),
);

describe("landmark pixel art", () => {
  it("has a sprite for every landmark on the maps", () => {
    const missing = [...names].filter((n) => !(n in LANDMARK_ART));
    expect(missing).toEqual([]);
  });

  it.each(Object.entries(LANDMARK_ART))(
    "%s is 32×32 and uses only palette colours",
    (_name, rows) => {
      expect(rows).toHaveLength(32);
      for (const row of rows) {
        expect(row).toHaveLength(32);
        for (const ch of row) {
          if (ch !== ".") expect(LANDMARK_PALETTE).toHaveProperty(ch);
        }
      }
      expect(rows.join("").replace(/\./g, "").length).toBeGreaterThan(100);
    },
  );

  it("draws every landmark differently", () => {
    const sprites = Object.values(LANDMARK_ART).map((rows) => rows.join(""));
    expect(new Set(sprites).size).toBe(sprites.length);
  });

  it("renders a crisp 32×32 SVG with one path per colour", () => {
    const host = document.createElement("div");
    render(landmarkArt("Eiffel Tower"), host);
    const svg = host.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 32 32");
    expect(svg.getAttribute("shape-rendering")).toBe("crispEdges");
    const colours = new Set(
      LANDMARK_ART["Eiffel Tower"].join("").replace(/\./g, ""),
    );
    expect(svg.querySelectorAll("path")).toHaveLength(colours.size);
  });

  it("has no art for an unknown landmark", () => {
    expect(landmarkArt("Nowhere")).toBeNull();
  });
});
