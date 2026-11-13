import { TileRef } from "@openfront/engine-api/game/GameMap";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { Game, Player, Unit } from "../game/Game";
import { CapitalExecution } from "./CapitalExecution";
import { SAMLauncherExecution } from "./SAMLauncherExecution";

/**
 * Builds `player`'s capital at `tier` (free) and starts its executions.
 * Uses `near` when the player owns it, else the owned tile farthest from it.
 * Returns null when they own no land.
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
  // Lost tile: go as far from it as possible, so the push that took it
  // can't take the new capital a few ticks later.
  // shortcut: scans every owned tile (O(tiles)) and may pick a far island over the main landmass; runs only on capture, upgrade if it matters in play.
  let best: TileRef | null = null;
  let bestDist = -1;
  for (const t of player.tiles()) {
    const d = near === null ? 0 : game.manhattanDist(t, near);
    if (d > bestDist || (d === bestDist && best !== null && t < best)) {
      best = t;
      bestDist = d;
    }
  }
  return best;
}
