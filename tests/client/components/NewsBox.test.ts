import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";
import newsItems from "../../../resources/news.json";
import { getNews } from "../../../src/client/Api";
import {
  filterNewsByPlatform,
  getVisibleNewsItems,
  NewsBox,
  NewsItem,
} from "../../../src/client/components/NewsBox";
import {
  fetchCosmetics,
  invalidateCosmetics,
  refreshStaleCosmetics,
} from "../../../src/client/Cosmetics";

vi.mock("../../../src/client/Api", () => ({
  getNews: vi.fn(async () => [
    {
      id: "md",
      title: "Markdown",
      type: "announcement",
      description: "Read the **rules** first",
    },
    { id: "md2", title: "Two", type: "announcement", description: "B" },
  ]),
}));

vi.mock("../../../src/client/Cosmetics", () => ({
  fetchCosmetics: vi.fn(async () => null),
  invalidateCosmetics: vi.fn(),
  refreshStaleCosmetics: vi.fn(() => true),
}));

/** A catalog running `sales`, with nothing else in it. */
function catalogWith(
  ...sales: { id: string; name: string; endsAt: string }[]
): Cosmetics {
  return {
    patterns: {},
    flags: {},
    promotions: sales.map((sale) => ({ percentOff: 25, ...sale })),
  } as unknown as Cosmetics;
}

const DISMISSED_NEWS_KEY = "dismissedNewsItems";
const allItems = newsItems as NewsItem[];

function createMockLocalStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
}

describe("NewsBox", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMockLocalStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("getVisibleNewsItems", () => {
    it("returns all items when none are dismissed", () => {
      const items = getVisibleNewsItems(allItems);
      expect(items.length).toBe(newsItems.length);
    });

    it("filters out dismissed items", () => {
      const items = getVisibleNewsItems(allItems);
      const firstId = items[0].id;
      localStorage.setItem(DISMISSED_NEWS_KEY, JSON.stringify([firstId]));
      const filtered = getVisibleNewsItems(allItems);
      expect(filtered.find((i) => i.id === firstId)).toBeUndefined();
      expect(filtered.length).toBe(items.length - 1);
    });

    it("returns empty when all items are dismissed", () => {
      const allIds = allItems.map((i) => i.id);
      localStorage.setItem(DISMISSED_NEWS_KEY, JSON.stringify(allIds));
      const items = getVisibleNewsItems(allItems);
      expect(items.length).toBe(0);
    });
  });

  describe("filterNewsByPlatform", () => {
    const everywhere: NewsItem = { id: "a", title: "A", type: "announcement" };
    const emptyList: NewsItem = {
      id: "b",
      title: "B",
      type: "announcement",
      platforms: [],
    };
    const webOnly: NewsItem = {
      id: "c",
      title: "C",
      type: "announcement",
      platforms: ["web", "crazygames"],
    };
    const items = [everywhere, emptyList, webOnly];

    it("hides items targeted at other platforms", () => {
      expect(filterNewsByPlatform(items, "steam").map((i) => i.id)).toEqual([
        "a",
        "b",
      ]);
    });

    it("shows items targeted at the current platform", () => {
      expect(filterNewsByPlatform(items, "web").map((i) => i.id)).toEqual([
        "a",
        "b",
        "c",
      ]);
    });
  });

  describe("the element", () => {
    afterEach(() => {
      document.body.innerHTML = "";
    });

    // The markdown renderer is its own chunk, loaded with the news.
    it("renders a description's markdown", async () => {
      const box = document.createElement("news-box");
      document.body.appendChild(box);

      await vi.waitFor(() =>
        expect(box.querySelector("strong")?.textContent).toBe("rules"),
      );
    });

    it("leaves the news alone for a sale not set to announce", async () => {
      const endsAt = new Date(Date.now() + 3_600_000).toISOString();
      vi.mocked(fetchCosmetics).mockResolvedValueOnce(
        catalogWith({ id: "7", name: "Quiet Sale", endsAt }),
      );
      const box = document.createElement("news-box");
      document.body.appendChild(box);

      await vi.waitFor(() => expect(box.textContent).toContain("Markdown"));
      expect(box.querySelector("[data-store-sale-banner]")).toBeNull();
    });

    describe("as time passes", () => {
      const MINUTE = 60_000;
      const sale = (id: string, name: string, endsInMs: number) => ({
        id,
        name,
        endsAt: new Date(Date.now() + endsInMs).toISOString(),
      });

      beforeEach(() => {
        vi.useFakeTimers();
        vi.mocked(invalidateCosmetics).mockClear();
        vi.mocked(refreshStaleCosmetics).mockClear();
      });

      afterEach(() => {
        vi.useRealTimers();
        vi.mocked(fetchCosmetics).mockReset();
        vi.mocked(fetchCosmetics).mockResolvedValue(null);
        vi.unstubAllGlobals();
        vi.stubGlobal("localStorage", createMockLocalStorage());
      });

      it("doesn't refetch while nobody can see the box", async () => {
        vi.mocked(fetchCosmetics).mockResolvedValue(catalogWith());
        const box = document.createElement("news-box");
        box.checkVisibility = () => false;
        document.body.appendChild(box);
        await vi.waitFor(() => expect(box.textContent).toContain("Markdown"));

        await vi.advanceTimersByTimeAsync(5 * MINUTE);

        expect(refreshStaleCosmetics).not.toHaveBeenCalled();
        expect(invalidateCosmetics).not.toHaveBeenCalled();
      });

      it("keeps rendering when a refetch brings fewer news items", async () => {
        // A sale not set to announce keeps the box refetching news.json.
        vi.mocked(fetchCosmetics).mockResolvedValue(
          catalogWith(sale("7", "Quiet Sale", 60 * MINUTE)),
        );
        const box = document.createElement("news-box");
        document.body.appendChild(box);
        await vi.waitFor(() => expect(box.textContent).toContain("Markdown"));
        // The cycle moves on to the second item.
        await vi.advanceTimersByTimeAsync(5_000);
        await vi.waitFor(() => expect(box.textContent).toContain("Two"));

        vi.mocked(getNews).mockResolvedValueOnce([
          { id: "only", title: "Only one", type: "announcement" },
        ]);
        await vi.advanceTimersByTimeAsync(5 * MINUTE);

        await vi.waitFor(() => expect(box.textContent).toContain("Only one"));
      });
    });

    it("does not start cycle timer if disconnected before loadNews resolves", async () => {
      const el = new NewsBox() as any;
      document.body.appendChild(el);
      el.remove();
      await new Promise((r) => setTimeout(r, 10));
      expect(el.cycleTimer).toBeNull();
    });
  });

  describe("news items structure", () => {
    it("each item has required fields", () => {
      const items = getVisibleNewsItems(allItems);
      for (const item of items) {
        expect(item.id).toBeDefined();
        expect(typeof item.id).toBe("string");
        expect(item.title).toBeDefined();
        expect(typeof item.title).toBe("string");
        const hasDescription =
          item.description !== undefined ||
          item.descriptionTranslationKey !== undefined;
        expect(hasDescription).toBe(true);
        expect(item.type).toBeDefined();
        expect(["tournament", "tutorial", "announcement", "warning"]).toContain(
          item.type,
        );
      }
    });

    it("each item has a unique id", () => {
      const items = getVisibleNewsItems(allItems);
      const ids = items.map((i) => i.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("contains a tournament entry", () => {
      const items = getVisibleNewsItems(allItems);
      expect(items.some((i) => i.type === "tournament")).toBe(true);
    });
  });
});
