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

/** Gold a held landmark pays per minute (10 ticks a second). */
const GOLD_PER_MINUTE = renderNumber(LANDMARK_GOLD_PER_TICK * 600n);
const TROOP_PERCENT = Math.round(LANDMARK_TROOP_BONUS * 100);
/**
 * The marker is a pin standing this far above its tile, so the tile itself
 * stays clickable (spawning or attacking onto a landmark).
 */
const PIN_GAP_PX = 6;
/** Markers this far past the screen edge are still drawn, so they slide in. */
const EDGE_PX = 40;
/** The card's width (w-56), its gap to the screen edge, and the room it needs above a pin. */
const CARD_W = 224;
const CARD_MARGIN = 8;
const CARD_ROOM_PX = 150;
/** Movement that turns a press on a pin into a map drag (InputHandler's threshold). */
const DRAG_PX = 10;

/** The element the map's InputHandler listens on. */
const mapInput = () => document.getElementById("game-input-overlay");

interface Spot {
  index: number;
  x: number;
  y: number;
}

/**
 * Landmark markers on the map: a ring in the holder's color around a
 * monument icon, with a card (name, holder, bonuses) on hover or tap.
 * Positions follow the camera every frame; holders refresh each tick.
 */
@customElement("landmark-overlay")
export class LandmarkOverlay extends LitElement implements Controller {
  game!: GameView;
  transformHandler!: TransformHandler;

  @state() private spots: Spot[] = [];
  @state() private openIndex: number | null = null;
  private frame: number | null = null;
  /** A press on a pin that is not yet a drag. */
  private press: { id: number; x: number; y: number } | null = null;
  /** Set when a press became a map drag, so its click does not toggle the card. */
  private dragged = false;

  createRenderRoot() {
    return this;
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
    // Holders change with the territory; markers and the card re-read them.
    if (this.spots.length > 0) this.requestUpdate();
  }

  getTickIntervalMs() {
    return 500;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.dispose();
  }

  private follow = () => {
    this.frame = requestAnimationFrame(this.follow);
    this.updateSpots();
  };

  /** Screen positions of the landmarks in view; skips a no-op re-render. */
  updateSpots() {
    const next: Spot[] = [];
    this.game.landmarks().forEach((l, index) => {
      const p = this.transformHandler.worldToScreenCoordinates(
        new Cell(l.x + 0.5, l.y + 0.5),
      );
      if (
        p.x >= -EDGE_PX &&
        p.y >= -EDGE_PX &&
        p.x <= window.innerWidth + EDGE_PX &&
        p.y <= window.innerHeight + EDGE_PX
      ) {
        next.push({ index, x: p.x, y: p.y });
      }
    });
    const prev = this.spots;
    const moved =
      next.length !== prev.length ||
      next.some(
        (s, i) =>
          s.index !== prev[i].index ||
          Math.abs(s.x - prev[i].x) > 0.5 ||
          Math.abs(s.y - prev[i].y) > 0.5,
      );
    if (moved) this.spots = next;
  }

  private ownerLine(owner: PlayerView | null): string {
    if (owner === null) return translateText("landmark.unclaimed");
    if (owner === this.game.myPlayer()) {
      return translateText("landmark.held_by_you");
    }
    return translateText("landmark.owner", { name: owner.displayName() });
  }

  private onPinPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.press = { id: e.pointerId, x: e.clientX, y: e.clientY };
    this.dragged = false;
  };

  /** Past the drag threshold the press is the map's: replay its start there. */
  private onPinPointerMove = (e: PointerEvent) => {
    const p = this.press;
    if (p === null || e.pointerId !== p.id) return;
    if (Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y) < DRAG_PX) return;
    this.press = null;
    this.dragged = true;
    mapInput()?.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: p.id,
        pointerType: e.pointerType,
        isPrimary: e.isPrimary,
        button: 0,
        buttons: 1,
        clientX: p.x,
        clientY: p.y,
        bubbles: true,
      }),
    );
  };

  private onPinClick = (index: number) => {
    this.press = null;
    if (this.dragged) {
      this.dragged = false;
      return;
    }
    this.openIndex = this.openIndex === index ? null : index;
  };

  private onPinWheel = (e: WheelEvent) => {
    e.preventDefault();
    mapInput()?.dispatchEvent(new WheelEvent("wheel", e));
  };

  private renderCard(spot: Spot) {
    const landmark = this.game.landmarks()[spot.index];
    const owner = this.game.landmarkOwner(spot.index);
    // Kept on screen: clamped sideways, and below the pin when there is no room above.
    const left = Math.min(
      Math.max(spot.x, CARD_W / 2 + CARD_MARGIN),
      window.innerWidth - CARD_W / 2 - CARD_MARGIN,
    );
    const below = spot.y < CARD_ROOM_PX;
    return html`<div
      data-landmark-card
      class="absolute pointer-events-none w-56 -translate-x-1/2 ${
        below ? "" : "-translate-y-full"
      } rounded-xl bg-gray-900/95 px-4 py-3 text-white shadow-2xl ring-1 ring-white/10"
      style="left: ${left}px; top: ${
        below ? spot.y + CARD_MARGIN : spot.y - PIN_GAP_PX - 36
      }px"
    >
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
    </div>`;
  }

  render() {
    if (this.spots.length === 0) return nothing;
    const open = this.spots.find((s) => s.index === this.openIndex);
    return html`<div class="fixed inset-0 z-[5] pointer-events-none">
      ${this.spots.map((spot) => {
        const landmark = this.game.landmarks()[spot.index];
        const owner = this.game.landmarkOwner(spot.index);
        return html`<button
          type="button"
          data-landmark
          aria-label=${landmark.name}
          class="absolute pointer-events-auto touch-none flex size-7 -translate-x-1/2 -translate-y-full items-center justify-center rounded-full border-2 bg-gray-900/85 text-white shadow-lg transition-transform hover:scale-110"
          style="left: ${spot.x}px; top: ${spot.y - PIN_GAP_PX}px; border-color: ${
            owner ? owner.territoryColor().toHex() : "rgba(255, 255, 255, 0.3)"
          }"
          @pointerenter=${(e: PointerEvent) => {
            // Hover is for a mouse; a tap's emulated enter would race the click.
            if (e.pointerType === "mouse") this.openIndex = spot.index;
          }}
          @pointerleave=${(e: PointerEvent) => {
            if (e.pointerType === "mouse") this.openIndex = null;
          }}
          @pointerdown=${this.onPinPointerDown}
          @pointermove=${this.onPinPointerMove}
          @wheel=${this.onPinWheel}
          @click=${() => this.onPinClick(spot.index)}
        >
          <svg viewBox="0 0 16 16" class="size-4" aria-hidden="true">
            <path
              fill="currentColor"
              d="M8 1 1.5 4.5V6h13V4.5L8 1Zm-5 6v5h2V7H3Zm4 0v5h2V7H7Zm4 0v5h2V7h-2ZM1.5 13v2h13v-2h-13Z"
            />
          </svg>
          <span
            class="absolute left-1/2 top-full -translate-x-1/2 border-x-4 border-t-[6px] border-x-transparent border-t-gray-900/85"
            aria-hidden="true"
          ></span>
        </button>`;
      })}
      ${open ? this.renderCard(open) : nothing}
    </div>`;
  }
}
