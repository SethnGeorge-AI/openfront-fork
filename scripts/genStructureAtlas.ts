// Writes resources/atlases/icon-atlas.png, the map's building icons, from the
// pixel art in src/client/hud/structureArt.ts. Run with
// `npx tsx scripts/genStructureAtlas.ts` after changing the art.
//
// Layout: one 64px column per building (32px art scaled 2x, nearest), in
// STRUCTURE_ART_ORDER. Top 64 rows: the art (owner accents stored as grey, the
// shader multiplies in the owner's colour). Bottom 64 rows: the accent mask.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import zlib from "zlib";
import { OUTLINE_OPACITY, PIXEL_PALETTE } from "../src/client/hud/pixelArt";
import {
  STRUCTURE_ART,
  STRUCTURE_ART_ORDER,
} from "../src/client/hud/structureArt";

const CELL = 64;
const SCALE = CELL / 32;
/** Owner accents as grey: the shader multiplies the owner's colour by this. */
const ACCENT_GREY: Record<string, number> = { F: 255, f: 175 };

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/** The atlas as raw RGBA, width x height. */
function atlasPixels(): { width: number; height: number; data: Buffer } {
  const width = CELL * STRUCTURE_ART_ORDER.length;
  const height = CELL * 2;
  const data = Buffer.alloc(width * height * 4);
  const set = (x: number, y: number, c: number[]) =>
    data.set(c, (y * width + x) * 4);
  STRUCTURE_ART_ORDER.forEach((type, col) => {
    STRUCTURE_ART[type].forEach((row, py) => {
      for (let px = 0; px < row.length; px++) {
        const ch = row[px];
        if (ch === ".") continue;
        const grey = ACCENT_GREY[ch];
        const art =
          grey !== undefined
            ? [grey, grey, grey, 255]
            : [
                ...rgb(PIXEL_PALETTE[ch]),
                ch === "k" ? Math.round(OUTLINE_OPACITY * 255) : 255,
              ];
        for (let dy = 0; dy < SCALE; dy++) {
          for (let dx = 0; dx < SCALE; dx++) {
            const x = col * CELL + px * SCALE + dx;
            const y = py * SCALE + dy;
            set(x, y, art);
            if (grey !== undefined) set(x, y + CELL, [255, 255, 255, 255]);
          }
        }
      }
    });
  });
  return { width, height, data };
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/** The atlas PNG bytes (deterministic, so a test can compare the committed file). */
export function structureAtlasPng(): Buffer {
  const { width, height, data } = atlasPixels();
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    rows.push(
      Buffer.from([0]),
      data.subarray(y * width * 4, (y + 1) * width * 4),
    );
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../resources/atlases/icon-atlas.png",
  );
  fs.writeFileSync(out, structureAtlasPng());
  console.log(`wrote ${out}`);
}
