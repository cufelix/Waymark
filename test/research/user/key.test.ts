import { describe, expect, it } from "vitest";
import { fill, stepsFromCalls } from "../../../src/agent/recipes";
import type { CallRecord } from "../../../src/agent/loop";
import { inputKey, platformOf, varsFor } from "../../../src/research/user/key";

describe("key", () => {
  it("turns a URL into a recipe key by host and path shape", () => {
    expect(inputKey("https://www.SoundCloud.com/janmusic?ref=x")).toBe("url:soundcloud.com/{seg1}");
    expect(inputKey("https://github.com/jan/repo")).toBe("url:github.com/{seg1}/{seg2}");
    expect(inputKey("https://jan.dev/")).toBe("url:jan.dev");
  });

  it("gives the variables a recipe can use, with the handle without @", () => {
    expect(varsFor("https://www.tiktok.com/@jan.cuts")).toEqual({ url: "https://www.tiktok.com/@jan.cuts", host: "tiktok.com", seg1: "@jan.cuts", handle: "jan.cuts" });
  });

  it("labels platforms and falls back to web", () => {
    expect(platformOf("https://m.soundcloud.com/x")).toBe("soundcloud");
    expect(platformOf("https://twitter.com/x")).toBe("x");
    expect(platformOf("https://youtu.be/abc")).toBe("youtube");
    expect(platformOf("https://jan.dev")).toBe("web");
  });

  it("a learned recipe replays for another seeker on the same platform", () => {
    const learnedFor = varsFor("https://github.com/torvalds");
    const calls: CallRecord[] = [
      { index: 0, tool: "fetch_url", params: { url: "https://github.com/torvalds" }, result: { ok: false, error: "x", usd: 0 } },
      { index: 1, tool: "github_api", params: { path: "/users/torvalds/repos?per_page=30" }, result: { ok: true, raw: [], text: "", usd: 0 } },
    ];
    const steps = stepsFromCalls(calls, [0, 1], learnedFor);
    expect(steps).toHaveLength(1); // the failed call is not kept
    const other = fill(steps[0]!.params, varsFor("https://github.com/janedoe"));
    expect(other).toEqual({ path: "/users/janedoe/repos?per_page=30" });
  });
});
