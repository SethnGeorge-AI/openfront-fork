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

/**
 * Two landmarks: the Eiffel Tower's tile centre is on screen at (105, 125),
 * the other is far off screen. `scale` is screen pixels per map tile.
 */
function mount(
  owner: PlayerView | null,
  me: PlayerView | null = null,
  scale = 10,
) {
  const game = {
    landmarks: () => [
      { name: "Eiffel Tower", x: 10, y: 12, tile: 0 },
      { name: "Far Away", x: 900, y: 900, tile: 1 },
    ],
    landmarkOwner: (i: number) => (i === 0 ? owner : null),
    myPlayer: () => me,
  } as unknown as GameView;
  const transformHandler = {
    scale,
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

/** A pointer event on the window, where the overlay hit-tests the art. */
function pointer(type: string, x: number, y: number, pointerType = "mouse") {
  window.dispatchEvent(
    new PointerEvent(type, {
      pointerType,
      pointerId: 3,
      button: 0,
      clientX: x,
      clientY: y,
    }),
  );
}

const card = (overlay: LandmarkOverlay) =>
  overlay.querySelector<HTMLElement>("[data-landmark-card]");

async function hoverCard(overlay: LandmarkOverlay) {
  await markers(overlay);
  pointer("pointermove", 105, 125);
  await overlay.updateComplete;
  return card(overlay);
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("LandmarkOverlay", () => {
  it("paints art only for landmarks on screen", async () => {
    const shown = await markers(mount(alice));
    expect(shown).toHaveLength(1);
    expect(shown[0].getAttribute("aria-label")).toBe("Eiffel Tower");
    expect(shown[0].querySelector("svg")).not.toBeNull();
  });

  it("sizes the art in map tiles, so it zooms with the terrain", async () => {
    const [near] = await markers(mount(alice, null, 10));
    expect(near.style.width).toBe("120px"); // 12 tiles at 10px a tile
    document.body.innerHTML = "";
    const [far] = await markers(mount(alice, null, 0.5));
    expect(far.style.width).toBe("18px"); // never smaller than 18px
  });

  it("centres the art on its tile", async () => {
    const [art] = await markers(mount(alice));
    expect([art.style.left, art.style.top]).toEqual(["105px", "125px"]);
    expect(art.className).toContain("-translate-x-1/2");
    expect(art.className).toContain("-translate-y-1/2");
  });

  it("takes no pointer events, so clicks, drags and zoom reach the map", async () => {
    const [art] = await markers(mount(alice));
    expect(art.className).toContain("pointer-events-none");
    expect(art.className).not.toContain("pointer-events-auto");
  });

  it("glows in its holder's colour, and not at all when unclaimed", async () => {
    const [held] = await markers(mount(alice));
    expect(held.style.filter).toContain("#ff0000");
    document.body.innerHTML = "";
    const [free] = await markers(mount(null));
    expect(free.style.filter).toBe("");
  });

  it("shows the name, owner and both bonuses while the mouse is over the art", async () => {
    const text = (await hoverCard(mount(alice)))?.textContent ?? "";
    expect(text).toContain("Eiffel Tower");
    expect(text).toContain('landmark.owner {"name":"Alice"}');
    expect(text).toContain(
      `landmark.gold_bonus {"amount":"${renderNumber(LANDMARK_GOLD_PER_TICK * 600n)}"}`,
    );
    expect(text).toContain(
      `landmark.troop_bonus {"percent":${Math.round(LANDMARK_TROOP_BONUS * 100)}}`,
    );
  });

  it("closes the card when the mouse leaves the art", async () => {
    const overlay = mount(alice);
    await hoverCard(overlay);
    pointer("pointermove", 500, 500);
    await overlay.updateComplete;
    expect(card(overlay)).toBeNull();
  });

  it("opens the card on a tap and closes it on the next tap", async () => {
    const overlay = mount(alice);
    await markers(overlay);
    const tap = async () => {
      pointer("pointerdown", 105, 125, "touch");
      pointer("pointerup", 106, 125, "touch");
      await overlay.updateComplete;
    };
    await tap();
    expect(card(overlay)).not.toBeNull();
    await tap();
    expect(card(overlay)).toBeNull();
  });

  it("does not open the card when a touch drag starts on the art", async () => {
    const overlay = mount(alice);
    await markers(overlay);
    pointer("pointerdown", 105, 125, "touch");
    pointer("pointerup", 160, 125, "touch");
    await overlay.updateComplete;
    expect(card(overlay)).toBeNull();
  });

  it("says unclaimed when nobody holds it", async () => {
    expect((await hoverCard(mount(null)))?.textContent).toContain(
      "landmark.unclaimed",
    );
  });

  it("says held by you when the viewer holds it", async () => {
    expect((await hoverCard(mount(alice, alice)))?.textContent).toContain(
      "landmark.held_by_you",
    );
  });

  it("shows the landmark's pixel art in the card", async () => {
    const c = await hoverCard(mount(alice));
    expect(c!.querySelector("[data-landmark-art] svg")).not.toBeNull();
  });

  it("keeps the card inside the screen near the left edge", async () => {
    // A 288px card centred on x = 105 would start at -39.
    const c = await hoverCard(mount(alice));
    expect(parseFloat(c!.style.left)).toBeGreaterThanOrEqual(144 + 8);
  });

  it("opens the card below the art near the top edge", async () => {
    // The 120px art spans y 65..185, too close to the top for a card above.
    const c = await hoverCard(mount(alice));
    expect(c!.className).not.toContain("-translate-y-full");
    expect(parseFloat(c!.style.top)).toBeGreaterThan(185);
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
