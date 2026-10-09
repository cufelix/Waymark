import { beforeEach, describe, expect, it, vi } from "vitest";

const okResult = (raw: unknown, text: string) => ({ ok: true as const, raw, text, usd: 0.001 });

vi.mock("../../../src/agent/loop", () => ({ runAgent: vi.fn() }));
vi.mock("../../../src/storage/snapshots", () => ({ saveSnapshot: vi.fn(async () => ({ key: "ab/abc.json", hash: "abc" })) }));
vi.mock("../../../src/tools", () => ({ readerTools: [], toolRegistry: new Map() }));
vi.mock("../../../src/agent/recipes", async (orig) => {
  const real = await orig<typeof import("../../../src/agent/recipes")>();
  return { ...real, getRecipe: vi.fn(), replay: vi.fn(), saveRecipe: vi.fn() };
});

import { runAgent } from "../../../src/agent/loop";
import { getRecipe, replay, saveRecipe } from "../../../src/agent/recipes";
import { readInput } from "../../../src/research/user/reader";

const link = { id: "lnk_1", url: "https://soundcloud.com/janbeats", addedAt: "2026-10-08T00:00:00Z" };

beforeEach(() => vi.clearAllMocks());

describe("readInput", () => {
  it("replays a learned recipe without calling the agent", async () => {
    vi.mocked(getRecipe).mockResolvedValue({
      key: "url:soundcloud.com/{seg1}", steps: [{ tool: "apify_run_actor", params: { actorId: "goat/sc", input: { url: "{url}" } } }],
      outputMap: {}, expectedShape: ["title"], runs: 3, successes: 3, usdPerRun: 0.001, status: "learned",
    });
    vi.mocked(replay).mockResolvedValue([okResult([{ title: "Night drive", user: { username: "janbeats" } }], "Night drive")]);

    const r = await readInput(link, "run_1");
    expect(runAgent).not.toHaveBeenCalled();
    expect(r.status).toBe("extracted");
    expect(r.learned).toBe(false);
    expect(r.artifact.items[0]?.title).toBe("Night drive");
    expect(r.artifact.owner?.handle).toBe("janbeats");
    expect(r.artifact.extractor).toBe("apify");
  });

  it("explores with the agent when there is no recipe, then saves a templated recipe", async () => {
    vi.mocked(getRecipe).mockResolvedValue(null);
    vi.mocked(runAgent).mockResolvedValue({
      finished: { usedCalls: [1], status: "extracted" },
      calls: [
        { index: 0, tool: "apify_store_search", params: { query: "soundcloud profile scraper" }, result: okResult([], "") },
        { index: 1, tool: "apify_run_actor", params: { actorId: "goat/sc", input: { startUrls: ["https://soundcloud.com/janbeats"] } }, result: okResult([{ title: "Track" }], "Track") },
      ],
      usd: 0.02,
      stopReason: "finished",
    });

    const r = await readInput(link, "run_1");
    expect(r.learned).toBe(true);
    expect(saveRecipe).toHaveBeenCalledWith(expect.objectContaining({
      key: "url:soundcloud.com/{seg1}",
      steps: [{ tool: "apify_run_actor", params: { actorId: "goat/sc", input: { startUrls: ["{url}"] } } }],
      expectedShape: ["title"],
    }));
  });

  it("reports unsupported without saving a recipe", async () => {
    vi.mocked(getRecipe).mockResolvedValue(null);
    vi.mocked(runAgent).mockResolvedValue({ finished: { usedCalls: [], status: "unsupported", reason: "needs login" }, calls: [], usd: 0.01, stopReason: "finished" });
    const r = await readInput(link, "run_1");
    expect(r).toMatchObject({ status: "unsupported", reason: "needs login", learned: false });
    expect(saveRecipe).not.toHaveBeenCalled();
  });
});
