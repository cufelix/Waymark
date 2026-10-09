import { describe, expect, it } from "vitest";
import { techTrends } from "../../src/research/market/rolemodels";

const repo = (owner: string, language: string, topics: string[] = []) => ({
  full_name: `${owner}/x`, html_url: `https://github.com/${owner}/x`, description: null, language, topics, stargazers_count: 0,
  fork: false, created_at: "", pushed_at: "", owner: { login: owner },
});

describe("role-model tech trends", () => {
  it("counts people, not repos, and labels rising and fading tech", () => {
    const now = [repo("a", "Python", ["llm"]), repo("a", "Python", ["llm"]), repo("b", "Python", ["llm"]), repo("c", "Rust")];
    const then = [repo("a", "JavaScript", ["jquery"]), repo("b", "JavaScript", ["jquery"]), repo("c", "Python")];
    const t = Object.fromEntries(techTrends(now, then).map((x) => [x.name, x]));
    expect(t.llm).toMatchObject({ kind: "topic", trend: "rising", nowShare: 0.67, thenShare: 0 });
    expect(t.jquery).toMatchObject({ trend: "fading", thenShare: 0.67 });
    expect(t.JavaScript?.trend).toBe("fading");
    expect(t.Rust).toBeUndefined(); // one person is not a trend
  });
});

import { spread } from "../../src/research/market/rolemodels";
describe("role-model sampling", () => {
  it("spreads the sample across an alphabetical list instead of taking the first names", () => {
    const logins = Array.from({ length: 100 }, (_, i) => `u${String(i).padStart(3, "0")}`);
    const s = spread(logins, 5);
    expect(s).toEqual(["u000", "u020", "u040", "u060", "u080"]);
  });
});
