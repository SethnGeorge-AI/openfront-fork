import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/client/Utils")>();
  return {
    ...actual,
    // The key plus its params, so a test sees both what was said and the values.
    translateText: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  };
});

import {
  LANDMARK_GOLD_PER_TICK,
  LANDMARK_TROOP_BONUS,
} from "@openfront/engine-lib/configuration/Config";
import { renderNumber } from "@openfront/engine-lib/Format";
import { GameMapImpl } from "@openfront/engine-lib/game/GameMapImpl";
// Registers <landmark-overlay> as a side effect.
import "../../src/client/hud/layers/LandmarkOverlay";
import type { LandmarkOverlay } from "../../src/client/hud/layers/LandmarkOverlay";
import type { TransformHandler } from "../../src/client/TransformHandler";
import type { GameView, PlayerView } from "../../src/client/view";
import { makeGameView } from "../util/viewStubs";

const alice = {
  displayName: () => "Alice",
  smallID: () => 1,
  territoryColor: () => ({ toHex: () => "#ff0000" }),
} as unknown as PlayerView;

/** Two landmarks: one on screen at (100, 120), one far off screen. */
function mount(owner: PlayerView | null, me: PlayerView | null = null) {
  const game = {
    landmarks: () => [
      { name: "Eiffel Tower", x: 10, y: 12, tile: 0 },
      { name: "Far Away", x: 900, y: 900, tile: 1 },
    ],
    landmarkOwner: (i: number) => (i === 0 ? owner : null),
    myPlayer: () => me,
  } as unknown as GameView;
  const transformHandler = {
    worldToScreenCoordinates: (c: { x: number; y: number }) =>
      c.x < 100 ? { x: c.x * 10, y: c.y * 10 } : { x: -5000, y: -5000 },
  } as unknown as TransformHandler;
  const overlay = document.createElement("landmark-overlay") as LandmarkOverlay;
  overlay.game = game;
  overlay.transformHandler = transformHandler;
  document.body.appendChild(overlay);
  return overlay;
}

async function markers(overlay: LandmarkOverlay) {
  overlay.updateSpots();
  await overlay.updateComplete;
  return [...overlay.querySelectorAll<HTMLElement>("[data-landmark]")];
}

async function hoverCard(overlay: LandmarkOverlay) {
  const [marker] = await markers(overlay);
  marker.dispatchEvent(
    new PointerEvent("pointerenter", { pointerType: "mouse" }),
  );
  await overlay.updateComplete;
  return overlay.querySelector<HTMLElement>("[data-landmark-card]");
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("LandmarkOverlay", () => {
  it("renders a marker only for landmarks on screen", async () => {
    const overlay = mount(alice);
    const shown = await markers(overlay);
    expect(shown).toHaveLength(1);
    expect(shown[0].getAttribute("aria-label")).toContain("Eiffel Tower");
  });

  it("pins the marker above its tile so clicks on the tile reach the map", async () => {
    const overlay = mount(alice);
    const [marker] = await markers(overlay);
    // The landmark tile's centre is at screen y = 125 (see mount()).
    const top = parseFloat(marker.style.top);
    expect(top).toBeLessThan(125);
    expect(marker.className).toContain("-translate-y-full");
  });

  it("rings a held landmark in its owner's color", async () => {
    const [marker] = await markers(mount(alice));
    expect(marker.style.borderColor).toBe("rgb(255, 0, 0)");
  });

  it("shows the name, owner and both bonuses on hover", async () => {
    const card = await hoverCard(mount(alice));
    const text = card?.textContent ?? "";
    expect(text).toContain("Eiffel Tower");
    expect(text).toContain('landmark.owner {"name":"Alice"}');
    expect(text).toContain(
      `landmark.gold_bonus {"amount":"${renderNumber(LANDMARK_GOLD_PER_TICK * 600n)}"}`,
    );
    expect(text).toContain(
      `landmark.troop_bonus {"percent":${Math.round(LANDMARK_TROOP_BONUS * 100)}}`,
    );
  });

  it("keeps the card inside the screen near the left edge", async () => {
    // The pin is at x = 105; a 224px card centred there would start at -7.
    const card = await hoverCard(mount(alice));
    expect(parseFloat(card!.style.left)).toBeGreaterThanOrEqual(112 + 8);
  });

  it("opens the card below the pin near the top edge", async () => {
    // The pin's tile is at y = 125, too close to the top for a card above it.
    const card = await hoverCard(mount(alice));
    expect(card!.className).not.toContain("-translate-y-full");
    expect(parseFloat(card!.style.top)).toBeGreaterThan(125);
  });

  it("passes the scroll wheel through to the map", async () => {
    const map = document.createElement("div");
    map.id = "game-input-overlay";
    document.body.appendChild(map);
    const wheels: WheelEvent[] = [];
    map.addEventListener("wheel", (e) => wheels.push(e as WheelEvent));
    const [marker] = await markers(mount(alice));
    marker.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 50, clientX: 105, clientY: 119 }),
    );
    expect(wheels.map((w) => [w.deltaY, w.clientX, w.clientY])).toEqual([
      [50, 105, 119],
    ]);
  });

  it("hands a drag that starts on a pin to the map, without opening the card", async () => {
    const map = document.createElement("div");
    map.id = "game-input-overlay";
    document.body.appendChild(map);
    const downs: PointerEvent[] = [];
    map.addEventListener("pointerdown", (e) => downs.push(e as PointerEvent));
    const overlay = mount(alice);
    const [marker] = await markers(overlay);
    const at = (type: string, x: number) =>
      new PointerEvent(type, {
        pointerId: 7,
        pointerType: "touch",
        button: 0,
        clientX: x,
        clientY: 119,
        bubbles: true,
      });
    marker.dispatchEvent(at("pointerdown", 105));
    marker.dispatchEvent(at("pointermove", 108));
    expect(downs).toHaveLength(0); // still a tap
    marker.dispatchEvent(at("pointermove", 130));
    expect(downs.map((d) => [d.pointerId, d.clientX, d.clientY])).toEqual([
      [7, 105, 119],
    ]);
    marker.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await overlay.updateComplete;
    expect(overlay.querySelector("[data-landmark-card]")).toBeNull();
  });

  it("says unclaimed when nobody holds it", async () => {
    const card = await hoverCard(mount(null));
    expect(card?.textContent).toContain("landmark.unclaimed");
  });

  it("says held by you when the viewer holds it", async () => {
    const card = await hoverCard(mount(alice, alice));
    expect(card?.textContent).toContain("landmark.held_by_you");
  });

  it("opens the card on a tap and closes it on the next tap", async () => {
    const overlay = mount(alice);
    const [marker] = await markers(overlay);
    // What a touchscreen fires for one tap.
    const tap = async () => {
      marker.dispatchEvent(
        new PointerEvent("pointerenter", { pointerType: "touch" }),
      );
      marker.dispatchEvent(new MouseEvent("mouseenter"));
      marker.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      marker.dispatchEvent(
        new PointerEvent("pointerleave", { pointerType: "touch" }),
      );
      await overlay.updateComplete;
    };
    await tap();
    expect(overlay.querySelector("[data-landmark-card]")).not.toBeNull();
    await tap();
    expect(overlay.querySelector("[data-landmark-card]")).toBeNull();
  });

  it("closes the card when the pointer leaves", async () => {
    const overlay = mount(alice);
    const [marker] = await markers(overlay);
    marker.dispatchEvent(
      new PointerEvent("pointerenter", { pointerType: "mouse" }),
    );
    await overlay.updateComplete;
    marker.dispatchEvent(
      new PointerEvent("pointerleave", { pointerType: "mouse" }),
    );
    await overlay.updateComplete;
    expect(overlay.querySelector("[data-landmark-card]")).toBeNull();
  });
});

describe("LandmarkOverlay frame loop", () => {
  it("runs one loop however many games init it", () => {
    let id = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => ++id);
    const cancel = vi.spyOn(window, "cancelAnimationFrame");
    const overlay = mount(alice);
    overlay.init();
    const first = id;
    overlay.init();
    expect(cancel).toHaveBeenCalledWith(first);
  });

  it("stops the loop and clears its pins when disposed", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 42);
    const cancel = vi.spyOn(window, "cancelAnimationFrame");
    const overlay = mount(alice);
    overlay.init();
    expect(await markers(overlay)).toHaveLength(1);
    overlay.dispose();
    await overlay.updateComplete;
    expect(cancel).toHaveBeenCalledWith(42);
    expect(overlay.querySelectorAll("[data-landmark]")).toHaveLength(0);
  });
});

describe("GameView landmarks", () => {
  const view = () => {
    const gameMap = new GameMapImpl(10, 10, new Uint8Array(100), 0);
    const gv = makeGameView({
      gameMap,
      landmarks: [
        { name: "A", coordinates: [1, 1] },
        { name: "B", coordinates: [2, 2] },
      ],
    });
    return { gv, gameMap };
  };

  it("lists the map's landmarks with their tiles", () => {
    const { gv } = view();
    expect(gv.landmarks()).toEqual([
      { name: "A", x: 1, y: 1, tile: gv.ref(1, 1) },
      { name: "B", x: 2, y: 2, tile: gv.ref(2, 2) },
    ]);
  });

  it("counts only the landmarks whose tile the player owns", () => {
    const { gv, gameMap } = view();
    gameMap.setOwnerID(gv.ref(1, 1), 1);
    gameMap.setOwnerID(gv.ref(2, 2), 2);
    expect(gv.landmarksHeldBy(alice)).toBe(1);
  });
});
