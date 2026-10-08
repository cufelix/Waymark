import { describe, expect, it } from "vitest";
import { seeds } from "../../scripts/seed-recipes";
import { inputKey, varsFor } from "../../src/research/user/key";

describe("seed recipes", () => {
  it.each(seeds.map((s) => [s.key, s] as const))("%s matches the key format and only uses known variables", (key, seed) => {
    expect(key).toMatch(/^url:[a-z0-9.-]+\/\{seg1\}$/);
    const host = key.slice(4, key.indexOf("/"));
    const url = `https://${host}/@someone`;
    expect(inputKey(url)).toBe(key);

    const known = new Set(Object.keys(varsFor(url)));
    const used = JSON.stringify(seed.steps).match(/\{(\w+)\}/g) ?? [];
    for (const ph of used) expect(known.has(ph.slice(1, -1))).toBe(true);

    expect(seed.steps.length).toBeGreaterThan(0);
    expect(seed.expectedShape.length).toBeGreaterThan(0);
  });

  it("caps every Apify run at 30 items", () => {
    for (const step of seeds.flatMap((s) => s.steps).filter((s) => s.tool === "apify_run_actor")) {
      expect(step.params.maxItems).toBeLessThanOrEqual(30);
    }
  });
});
