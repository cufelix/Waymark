import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCache, isGoodMatch, resolveSkill, searchOccupations, searchSkills } from "../../../src/shared/taxonomy";
import * as stub from "../../../src/shared/taxonomy/stub";

const reply = (results: Array<{ uri: string; title: string }>) =>
  new Response(JSON.stringify({ _embedded: { results } }), { status: 200 });

beforeEach(() => clearCache());
afterEach(() => vi.unstubAllGlobals());

describe("search + cache", () => {
  it("maps results and serves repeats from cache", async () => {
    const f = vi.fn(async () => reply([{ uri: "u1", title: "Docker" }]));
    vi.stubGlobal("fetch", f);
    const a = await searchSkills("docker");
    const b = await searchSkills("docker");
    expect(a).toEqual([{ uri: "u1", label: "Docker", lang: "en" }]);
    expect(b).toEqual(a);
    expect(f).toHaveBeenCalledTimes(1);
    const url = String((f.mock.calls[0] as unknown[])[0]);
    expect(url).toContain("type=skill");
    expect(url).toContain("language=en");
  });

  it("keys the cache by type", async () => {
    const f = vi.fn(async () => reply([{ uri: "u", title: "x" }]));
    vi.stubGlobal("fetch", f);
    await searchSkills("x");
    await searchOccupations("x");
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe("resolveSkill", () => {
  it("falls back to custom on fetch error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect(await resolveSkill("Rust Lang")).toEqual({ uri: "custom:rust-lang", label: "Rust Lang", lang: "en" });
  });

  it("falls back to custom on HTTP error and on no good match", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    expect((await resolveSkill("Go")).uri).toBe("custom:go");
    clearCache();
    vi.stubGlobal("fetch", vi.fn(async () => reply([{ uri: "u", title: "gopher care" }])));
    expect((await resolveSkill("Go")).uri).toBe("custom:go");
  });

  it("picks the first good match", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply([
      { uri: "a", title: "dockerize nothing" },
      { uri: "b", title: "use Docker containers" },
    ])));
    expect(await resolveSkill("docker")).toEqual({ uri: "b", label: "use Docker containers", lang: "en" });
  });
});

describe("isGoodMatch", () => {
  it("equal ignoring case", () => expect(isGoodMatch("SQL", "sql")).toBe(true));
  it("whole word inside title", () => expect(isGoodMatch("use Docker containers", "docker")).toBe(true));
  it("rejects substrings", () => expect(isGoodMatch("dockerize", "docker")).toBe(false));
  it("escapes regex chars", () => expect(isGoodMatch("C++ programming", "c++")).toBe(true));
});

describe("stub", () => {
  it("works offline", async () => {
    expect((await stub.searchOccupations("nurse"))[0]?.label).toBe("nurse");
    expect((await stub.resolveSkill("SQL")).uri).toContain("stub-sql");
    expect((await stub.resolveSkill("Zig")).uri).toBe("custom:zig");
  });
});

describe.skipIf(!process.env.LIVE)("live ESCO", () => {
  it("Docker and nurse", async () => {
    const docker = await resolveSkill("Docker");
    const nurse = await searchOccupations("nurse", "en", 3);
    console.log("LIVE docker:", JSON.stringify(docker));
    console.log("LIVE nurse:", JSON.stringify(nurse));
    expect(docker.uri.length).toBeGreaterThan(0);
    expect(nurse.length).toBeGreaterThan(0);
  });
}, 30_000);
