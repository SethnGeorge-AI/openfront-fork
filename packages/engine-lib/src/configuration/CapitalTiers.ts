import {
  Gold,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PlayerLike, UnitLike } from "@openfront/engine-api/game/ReadViews";

/** Capital tiers (docs/superpowers/specs/2026-11-13-capital-tech-tiers-design.md). */
export const CAPITAL_MAX_TIER = 5;
export const CAPITAL_UPGRADE_TICKS = 300;
/** Defense Post's 30-tile defense radius, 15% bigger. */
export const CAPITAL_DEFENSE_RANGE = 35;
export const CAPITAL_SAM_COOLDOWN = 1;

const TIER_COSTS: readonly Gold[] = [
  0n,
  0n,
  250_000n,
  750_000n,
  2_000_000n,
  5_000_000n,
];

/** Gold to upgrade the capital into `targetTier`; 0 outside 2..5. */
export function capitalTierCost(targetTier: number): Gold {
  return TIER_COSTS[targetTier] ?? 0n;
}

/** Minimum capital tier to build `type`; 0 means never gated. */
export function requiredCapitalTier(type: UnitType): number {
  switch (type) {
    case UnitType.City:
    case UnitType.DefensePost:
      return 1;
    case UnitType.Port:
    case UnitType.Factory:
      return 2;
    case UnitType.SAMLauncher:
    case UnitType.MissileSilo:
    case UnitType.AtomBomb:
      return 3;
    case UnitType.HydrogenBomb:
    case UnitType.Warship:
      return 4;
    case UnitType.MIRV:
      return 5;
    default:
      return 0;
  }
}

export function capitalOf(player: PlayerLike): UnitLike | null {
  return player.units(UnitType.Capital)[0] ?? null;
}

/**
 * A structure is offline while its owner's capital tier is below what it
 * needs (tier dropped, or captured from a higher-tier player).
 */
export function isOffline(unit: UnitLike, enabled: boolean): boolean {
  if (!enabled || unit.type() === UnitType.Capital) return false;
  const owner = unit.owner();
  if (owner.type() === PlayerType.Bot) return false;
  return requiredCapitalTier(unit.type()) > capitalTier(owner);
}

/** Gold per tick in percent: +10% per tier above 1. */
export function capitalGoldMultiplierPct(tier: number): number {
  return 100 + 10 * Math.max(0, tier - 1);
}

/** Troop growth factor: +5% per tier above 1. */
export function capitalTroopMultiplier(tier: number): number {
  return 1 + 0.05 * Math.max(0, tier - 1);
}

/** The capital's level, or 0 with no capital. */
export function capitalTier(player: PlayerLike): number {
  return capitalOf(player)?.level() ?? 0;
}
