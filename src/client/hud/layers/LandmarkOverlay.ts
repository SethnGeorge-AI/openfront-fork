import { Cell } from "@openfront/engine-api/game/GameTypes";
import {
  LANDMARK_GOLD_PER_TICK,
  LANDMARK_TROOP_BONUS,
} from "@openfront/engine-lib/configuration/Config";
import { renderNumber } from "@openfront/engine-lib/Format";
import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { Controller } from "../../Controller";
import type { TransformHandler } from "../../TransformHandler";
import { translateText } from "../../Utils";
import type { GameView, PlayerView } from "../../view";
import { landmarkArt } from "../landmarkArt";

/** Gold a held landmark pays per minute (10 ticks a second). */
const GOLD_PER_MINUTE = renderNumber(LANDMARK_GOLD_PER_TICK * 600n);
const TROOP_PERCENT = Math.round(LANDMARK_TROOP_BONUS * 100);
/** The art spans this many map tiles, so it zooms with the terrain... */
const ART_TILES = 12;
/** ...but never shrinks below this, so a landmark stays findable zoomed out. */
const ART_MIN_PX = 18;
/** The card's width (w-72), its gap to the screen edge, and the room it needs above the art. */
const CARD_W = 288;
const CARD_MARGIN = 8;
const CARD_ROOM_PX = 150;
/** A touch that moves this far is a map drag, not a tap (InputHandler's threshold). */
const DRAG_PX = 10;

interface Spot {
  index: number;
  x: number;
  y: number;
  /** Side of the art's square on screen, in pixels. */
  size: number;
}

/**
 * Landmark art painted onto the map: each landmark's pixel art, centred on its
 * tile and sized in map tiles, glowing in its holder's colour. The art takes no
 * pointer events, so the map keeps every click, drag and zoom; hovering it with
 * a mouse, or tapping it, opens a card (name, holder, bonuses). Positions follow
 * the camera every frame; holders refresh each tick.
 */
@customElement("landmark-overlay")
export class LandmarkOverlay extends LitElement implements Controller {
  game!: GameView;
  transformHandler!: TransformHandler;

  @state() private spots: Spot[] = [];
  @state() private openIndex: number | null = null;
  private frame: number | null = null;
  /** Where a touch began, to tell a tap on the art from a map drag. */
  private press: { id: number; x: number; y: number } | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerUp);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.dispose();
  }

  init() {
    // The element outlives games: a new one replaces the previous loop.
    this.dispose();
    if (this.game.landmarks().length === 0) return;
    this.follow();
  }

  dispose() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.spots = [];
    this.openIndex = null;
  }

  tick() {
    // Holders change with the territory; the art and the card re-read them.
    if (this.spots.length > 0) this.requestUpdate();
  }

  getTickIntervalMs() {
    return 500;
  }

  private follow = () => {
    this.frame = requestAnimationFrame(this.follow);
    this.updateSpots();
  };

  /** Screen positions and sizes of the landmarks in view; skips a no-op re-render. */
  updateSpots() {
    const size = Math.max(ART_MIN_PX, ART_TILES * this.transformHandler.scale);
    const next: Spot[] = [];
    this.game.landmarks().forEach((l, index) => {
      const p = this.transformHandler.worldToScreenCoordinates(
        new Cell(l.x + 0.5, l.y + 0.5),
      );
      const half = size / 2;
      if (
        p.x >= -half &&
        p.y >= -half &&
        p.x <= window.innerWidth + half &&
        p.y <= window.innerHeight + half
      ) {
        next.push({ index, x: p.x, y: p.y, size });
      }
    });
    const prev = this.spots;
    const moved =
      next.length !== prev.length ||
      next.some(
        (s, i) =>
          s.index !== prev[i].index ||
          Math.abs(s.x - prev[i].x) > 0.5 ||
          Math.abs(s.y - prev[i].y) > 0.5 ||
          Math.abs(s.size - prev[i].size) > 0.5,
      );
    if (moved) this.spots = next;
  }

  /** The landmark whose art is under a screen point (the last drawn wins). */
  private hit(x: number, y: number): number | null {
    for (let i = this.spots.length - 1; i >= 0; i--) {
      const s = this.spots[i];
      if (Math.abs(x - s.x) <= s.size / 2 && Math.abs(y - s.y) <= s.size / 2) {
        return s.index;
      }
    }
    return null;
  }

  private onPointerMove = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || this.spots.length === 0) return;
    const index = this.hit(e.clientX, e.clientY);
    if (index !== this.openIndex) this.openIndex = index;
  };

  private onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse" || e.button !== 0) return;
    this.press = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };

  /** A touch that lifts where it landed toggles the card of the art it hit. */
  private onPointerUp = (e: PointerEvent) => {
    const p = this.press;
    if (p === null || e.pointerId !== p.id) return;
    this.press = null;
    if (Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y) >= DRAG_PX)
      return;
    const index = this.hit(p.x, p.y);
    this.openIndex = index === null || index === this.openIndex ? null : index;
  };

  private ownerLine(owner: PlayerView | null): string {
    if (owner === null) return translateText("landmark.unclaimed");
    if (owner === this.game.myPlayer()) {
      return translateText("landmark.held_by_you");
    }
    return translateText("landmark.owner", { name: owner.displayName() });
  }

  private renderCard(spot: Spot) {
    const landmark = this.game.landmarks()[spot.index];
    const owner = this.game.landmarkOwner(spot.index);
    const art = landmarkArt(landmark.name);
    // Kept on screen: clamped sideways, and below the art when there is no room above.
    const left = Math.min(
      Math.max(spot.x, CARD_W / 2 + CARD_MARGIN),
      window.innerWidth - CARD_W / 2 - CARD_MARGIN,
    );
    const top = spot.y - spot.size / 2;
    const below = top < CARD_ROOM_PX;
    return html`<div
      data-landmark-card
      class="absolute pointer-events-none flex w-72 items-center gap-3 -translate-x-1/2 ${
        below ? "" : "-translate-y-full"
      } rounded-xl bg-gray-900/95 px-4 py-3 text-white shadow-2xl ring-1 ring-white/10"
      style="left: ${left}px; top: ${
        below ? spot.y + spot.size / 2 + CARD_MARGIN : top - CARD_MARGIN
      }px"
    >
      ${
        art
          ? html`<div
              data-landmark-art
              class="size-16 shrink-0 rounded-lg bg-white/5 p-0.5"
            >
              ${art}
            </div>`
          : nothing
      }
      <div class="min-w-0">
        <div class="text-sm font-bold uppercase tracking-wider text-yellow-300">
          ${landmark.name}
        </div>
        <div class="mt-1 text-sm text-white/80">${this.ownerLine(owner)}</div>
        <div class="mt-2 space-y-0.5 text-xs font-semibold">
          <div class="text-amber-300">
            ${translateText("landmark.gold_bonus", { amount: GOLD_PER_MINUTE })}
          </div>
          <div class="text-emerald-300">
            ${translateText("landmark.troop_bonus", { percent: TROOP_PERCENT })}
          </div>
        </div>
      </div>
    </div>`;
  }

  render() {
    if (this.spots.length === 0) return nothing;
    const open = this.spots.find((s) => s.index === this.openIndex);
    return html`<div class="fixed inset-0 z-[5] pointer-events-none">
      ${this.spots.map((spot) => {
        const landmark = this.game.landmarks()[spot.index];
        const owner = this.game.landmarkOwner(spot.index);
        const glow = owner
          ? `drop-shadow(0 0 2px ${owner.territoryColor().toHex()}) drop-shadow(0 0 1px ${owner.territoryColor().toHex()})`
          : "";
        return html`<div
          data-landmark
          aria-label=${landmark.name}
          class="absolute pointer-events-none -translate-x-1/2 -translate-y-1/2"
          style="left: ${spot.x}px; top: ${spot.y}px; width: ${spot.size}px; height: ${spot.size}px; filter: ${glow}"
        >
          ${landmarkArt(landmark.name)}
        </div>`;
      })}
      ${open ? this.renderCard(open) : nothing}
    </div>`;
  }
}
