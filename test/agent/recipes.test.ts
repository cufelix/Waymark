import { describe, expect, it } from "vitest";
import { fill, templatize, validateSteps } from "../../src/agent/recipes";

describe("recipe templating", () => {
  it("round-trips and never re-scans a placeholder", () => {
    const vars = { url: "https://soundcloud.com/company", seg1: "company", handle: "company", host: "soundcloud.com" };
    const t = templatize({ startUrls: [{ url: "https://soundcloud.com/company" }], q: "company tracks" }, vars);
    expect(t).toEqual({ startUrls: [{ url: "{url}" }], q: "{handle} tracks" });
    expect(fill(t, { ...vars, url: "https://soundcloud.com/other", seg1: "other", handle: "other" })).toEqual({ startUrls: [{ url: "https://soundcloud.com/other" }], q: "other tracks" });
  });

  it("keeps literal braces and ignores prototype names", () => {
    const t = templatize({ gql: "{ user { id } }", x: "{constructor}" }, { seg1: "jan" });
    expect(fill(t, { seg1: "jan" })).toEqual({ gql: "{ user { id } }", x: "{constructor}" });
  });
});

describe("recipe validation", () => {
  const step = (params: Record<string, unknown>, tool = "apify_run_actor") => [{ tool, params }];
  it("accepts placeholders and the key's own host", () => {
    expect(validateSteps("url:tiktok.com/{seg1}", step({ profiles: ["{url}"], startUrls: ["https://www.tiktok.com/@{handle}"] }))).toBeNull();
  });
  it("rejects literal URLs to another host (recipe poisoning)", () => {
    expect(validateSteps("url:tiktok.com/{seg1}", step({ startUrls: ["https://evil.example/collect"] }))).toMatch(/not allowed/);
  });
  it("rejects tools outside the allowlist and empty recipes", () => {
    expect(validateSteps("url:x.com/{seg1}", step({}, "shell"))).toMatch(/not allowed/);
    expect(validateSteps("url:x.com/{seg1}", [])).toMatch(/1 to 5/);
  });
});
