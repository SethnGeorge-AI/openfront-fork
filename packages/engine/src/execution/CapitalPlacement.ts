import { TileRef } from "@openfront/engine-api/game/GameMap";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { Game, Player, Unit } from "../game/Game";
import { CapitalExecution } from "./CapitalExecution";
import { SAMLauncherExecution } from "./SAMLauncherExecution";

/**
 * Builds `player`'s capital at `tier` (free) and starts its executions.
 * Uses `near` when the player owns it, else the owned tile closest to the
 * centre of their largest territory. Returns null when they own no land.
 */
export function placeCapital(
  game: Game,
  player: Player,
  tier: number,
  near: TileRef | null,
): Unit | null {
  const tile = pickCapitalTile(game, player, near);
  if (tile === null) return null;
  const capital = player.buildUnit(UnitType.Capital, tile, {});
  for (let level = 1; level < tier; level++) capital.increaseLevel();
  game.addExecution(new SAMLauncherExecution(player, null, capital));
  game.addExecution(new CapitalExecution(capital));
  return capital;
}

function pickCapitalTile(
  game: Game,
  player: Player,
  near: TileRef | null,
): TileRef | null {
  if (near !== null && game.owner(near) === player) return near;
  const box = player.largestClusterBoundingBox ?? null;
  let cx: number;
  let cy: number;
  if (box !== null) {
    cx = Math.floor((box.min.x + box.max.x) / 2);
    cy = Math.floor((box.min.y + box.max.y) / 2);
  } else if (near !== null) {
    cx = game.x(near);
    cy = game.y(near);
  } else {
    cx = 0;
    cy = 0;
  }
  // shortcut: scans every owned tile (O(tiles)); runs only on placement and capture, upgrade if profiling shows it.
  let best: TileRef | null = null;
  let bestDist = Infinity;
  for (const t of player.tiles()) {
    const dx = game.x(t) - cx;
    const dy = game.y(t) - cy;
    const d = dx * dx + dy * dy;
    if (d < bestDist || (d === bestDist && best !== null && t < best)) {
      best = t;
      bestDist = d;
    }
  }
  return best;
}
