import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import "../../src/client/hud/layers/UnitDisplay";
import type { UnitDisplay } from "../../src/client/hud/layers/UnitDisplay";
import { SendUpgradeStructureIntentEvent } from "../../src/client/Transport";

function makeDisplay(capital: object | null, gold = 10_000_000n, ticks = 0) {
  const player = {
    gold: () => gold,
    isAlive: () => true,
    units: (t: UnitType) =>
      t === UnitType.Capital && capital ? [capital] : [],
  };
  const eventBus = new EventBus();
  const display = document.createElement("unit-display") as UnitDisplay;
  display.game = {
    myPlayer: () => player,
    inSpawnPhase: () => false,
    ticks: () => ticks,
    config: () => ({
      isUnitDisabled: () => false,
      gameConfig: () => ({}),
    }),
  } as any;
  display.eventBus = eventBus;
  display.inputHandler = { setGhostStructure: vi.fn() } as any;
  display.uiState = { ghostStructure: null, upgradeMultiplier: 1 } as any;
  display.init();
  document.body.appendChild(display);
  display.requestUpdate();
  return { display, eventBus };
}

function capital(level: number, upgradeAt: number | null = null) {
  return {
    id: () => 42,
    level: () => level,
    capitalUpgradeAt: () => upgradeAt,
  };
}

describe("UnitDisplay capital button", () => {
  test("shows the tier and upgrades the capital on click", async () => {
    const { display, eventBus } = makeDisplay(capital(2));
    const sent: SendUpgradeStructureIntentEvent[] = [];
    eventBus.on(SendUpgradeStructureIntentEvent, (e) => sent.push(e));
    await display.updateComplete;
    const button = display.querySelector<HTMLElement>(".capital-button");
    expect(button?.textContent).toContain("2");
    button!.click();
    expect(sent).toHaveLength(1);
    expect(sent[0].unitId).toBe(42);
    expect(sent[0].unitType).toBe(UnitType.Capital);
    display.remove();
  });

  test("shows the seconds left while upgrading and does not send", async () => {
    const { display, eventBus } = makeDisplay(
      capital(1, 250),
      10_000_000n,
      100,
    );
    const sent: unknown[] = [];
    eventBus.on(SendUpgradeStructureIntentEvent, (e) => sent.push(e));
    await display.updateComplete;
    const button = display.querySelector<HTMLElement>(".capital-button");
    expect(button?.textContent).toContain("15s");
    button!.click();
    expect(sent).toHaveLength(0);
    display.remove();
  });

  test("no button without a capital", async () => {
    const { display } = makeDisplay(null);
    await display.updateComplete;
    expect(display.querySelector(".capital-button")).toBeNull();
    display.remove();
  });

  test("uses the engine's price (infinite gold makes it free)", async () => {
    const { display, eventBus } = makeDisplay(capital(1), 100n);
    (display as any).playerBuildables = [{ type: UnitType.Capital, cost: 0n }];
    const sent: unknown[] = [];
    eventBus.on(SendUpgradeStructureIntentEvent, (e) => sent.push(e));
    display.requestUpdate();
    await display.updateComplete;
    display.querySelector<HTMLElement>(".capital-button")!.click();
    expect(sent).toHaveLength(1);
    display.remove();
  });
});
