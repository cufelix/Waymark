import { describe, expect, it } from "vitest";
import { computeTrends, eras } from "../../src/research/market/trends";

describe("then vs now skill trends", () => {
  it("labels rising, fading and stable skills, with today's vacancies as the ground truth for now", () => {
    const then = new Map([["jquery", 6], ["sql", 5], ["git", 1]]);
    const now = new Map([["react", 6], ["sql", 5]]);
    const vacancies = new Map([["docker", 0.7]]);
    const t = computeTrends(then, 8, now, 8, vacancies);
    expect(t.get("jquery")).toMatchObject({ trend: "fading", thenShare: 0.75, nowShare: 0 });
    expect(t.get("react")?.trend).toBe("rising");
    expect(t.get("docker")).toMatchObject({ trend: "rising", nowShare: 0.7 });
    expect(t.get("sql")?.trend).toBe("stable");
    expect(t.has("git")).toBe(false); // seen in one document only: noise
  });

  it("compares about ten years ago with the last 12 months", () => {
    const e = eras(new Date("2026-10-08T00:00:00Z"));
    expect(e.then).toEqual({ from: "2016-01-01", to: "2019-12-31" });
    expect(e.now.to).toBe("2026-10-08");
  });
});
