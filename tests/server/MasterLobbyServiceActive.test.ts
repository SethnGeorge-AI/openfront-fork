import EventEmitter from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MasterLobbyService } from "../../src/server/MasterLobbyService";
import { startPolling } from "../../src/server/PollingLoop";
import { ServerEnv } from "../../src/server/ServerEnv";

vi.mock("../../src/server/Logger", () => ({
  logger: {
    child: () => ({
      error: vi.fn(),
      info: vi.fn(),
    }),
  },
}));

// Capture the scheduling loop instead of running it, so a test can invoke a
// single scheduling pass by hand.
vi.mock("../../src/server/PollingLoop", () => ({
  startPolling: vi.fn(),
}));

function createMockWorker(): EventEmitter & { send: ReturnType<typeof vi.fn> } {
  const emitter = new EventEmitter() as EventEmitter & {
    send: ReturnType<typeof vi.fn>;
  };
  emitter.send = vi.fn();
  return emitter;
}

function broadcastTask(): () => Promise<void> {
  const calls = vi.mocked(startPolling).mock.calls;
  const call = calls.find(([, intervalMs]) => intervalMs === 500);
  if (call === undefined) throw new Error("broadcast loop was not started");
  return call[0];
}

describe("MasterLobbyService active/inactive deployment", () => {
  let worker: ReturnType<typeof createMockWorker>;
  let service: MasterLobbyService;

  beforeEach(() => {
    // Scheduling mints game ids under the own instance letter, which resolves
    // through DOMAIN against the dev-default cluster map.
    vi.stubEnv("DOMAIN", "localhost");
    vi.spyOn(ServerEnv, "numWorkers").mockReturnValue(1);
    const playlist = { gameConfig: vi.fn(async () => ({})) };
    const log = { info: vi.fn(), error: vi.fn() } as any;
    service = new MasterLobbyService(playlist as any, log);
    worker = createMockWorker();
    service.registerWorker(0, worker as any);
    worker.emit("message", { type: "workerReady", workerId: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.mocked(startPolling).mockClear();
  });

  // This fork has no public lobbies: only the broadcast loop runs, never
  // the scheduler, and no worker is asked to create a game.
  it("never schedules public lobbies", () => {
    const intervals = vi.mocked(startPolling).mock.calls.map(([, ms]) => ms);
    expect(intervals).toEqual([500]);
    expect(
      worker.send.mock.calls.filter(([msg]) => msg.type === "createGame"),
    ).toEqual([]);
  });

  // Workers stamp this flag onto the public-lobby feed so pinned tabs on a
  // draining deployment get told to reload instead of watching the lobby
  // list empty out.
  it("tells workers whether the deployment is active in every broadcast", async () => {
    await broadcastTask()();
    let broadcasts = worker.send.mock.calls.filter(
      ([msg]) => msg.type === "lobbiesBroadcast",
    );
    expect(broadcasts[broadcasts.length - 1]?.[0].active).toBe(true);

    service.setActive(false);
    await broadcastTask()();
    broadcasts = worker.send.mock.calls.filter(
      ([msg]) => msg.type === "lobbiesBroadcast",
    );
    expect(broadcasts[broadcasts.length - 1]?.[0].active).toBe(false);
  });
});

describe("MasterLobbyService awaiting the API's first answer", () => {
  let worker: ReturnType<typeof createMockWorker>;
  let service: MasterLobbyService;

  beforeEach(() => {
    // The describe above leaves its loops registered; broadcastTask() takes
    // the first match.
    vi.mocked(startPolling).mockClear();
    vi.stubEnv("DOMAIN", "localhost");
    vi.spyOn(ServerEnv, "numWorkers").mockReturnValue(1);
    const playlist = { gameConfig: vi.fn(async () => ({})) };
    const log = { info: vi.fn(), error: vi.fn() } as any;
    service = new MasterLobbyService(playlist as any, log, true);
    worker = createMockWorker();
    service.registerWorker(0, worker as any);
    worker.emit("message", { type: "workerReady", workerId: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.mocked(startPolling).mockClear();
  });

  function lastBroadcastActive(): boolean | undefined {
    const broadcasts = worker.send.mock.calls.filter(
      ([msg]) => msg.type === "lobbiesBroadcast",
    );
    return broadcasts[broadcasts.length - 1]?.[0].active;
  }

  // active:false on the feed makes every connected tab prompt a reload; a
  // server that merely has not heard from the API yet must not send it.
  it("does not tell clients to leave before the API has answered", async () => {
    await broadcastTask()();
    expect(lastBroadcastActive()).toBe(true);

    service.setActive(false);
    await broadcastTask()();
    expect(lastBroadcastActive()).toBe(false);
  });
});
