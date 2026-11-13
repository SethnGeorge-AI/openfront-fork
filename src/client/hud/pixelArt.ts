/**
 * Shared 32x32 pixel-art format for landmarks and buildings: one character per
 * pixel, "." transparent, every other character a colour of PIXEL_PALETTE,
 * whose tones are sampled from the map's own terrain so art blends into it.
 * Original art for this fork (CC BY-SA 4.0, like the repository's other assets).
 */
export const PIXEL_PALETTE: Record<string, string> = {
  k: "#3a3426",
  w: "#ece6d8",
  l: "#c9c3b5",
  g: "#948d7e",
  d: "#635d50",
  s: "#e2cca6",
  S: "#c2ad87",
  D: "#96895a",
  b: "#8d6e4a",
  B: "#5a4430",
  r: "#a8553f",
  R: "#7a3a2c",
  o: "#c07a4a",
  y: "#d9bd6a",
  z: "#b8964a",
  G: "#8a9a5b",
  n: "#686c48",
  N: "#4a5636",
  c: "#b1c2cd",
  u: "#3d6b8e",
  U: "#2c5373",
  p: "#c49a7e",
  P: "#8f6450",
  m: "#7fa396",
  M: "#557a6e",
};

/** The outline ("k") is drawn see-through, so edges soften into the terrain. */
export const OUTLINE_OPACITY = 0.6;

/** SVG path data per colour: each horizontal run of one colour is a rectangle. */
export function pixelArtPaths(rows: readonly string[]): Map<string, string> {
  const paths = new Map<string, string>();
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      const ch = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === ch) end++;
      if (ch !== ".") {
        paths.set(
          ch,
          `${paths.get(ch) ?? ""}M${x} ${y}h${end - x}v1h-${end - x}z`,
        );
      }
      x = end;
    }
  });
  return paths;
}

/** A standalone SVG document for `rows`; `colours` maps every used character. */
export function pixelArtSvg(
  rows: readonly string[],
  colours: Record<string, string>,
): string {
  let body = "";
  for (const [ch, d] of pixelArtPaths(rows)) {
    const opacity = ch === "k" ? ` fill-opacity="${OUTLINE_OPACITY}"` : "";
    body += `<path fill="${colours[ch]}"${opacity} d="${d}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" shape-rendering="crispEdges">${body}</svg>`;
}
