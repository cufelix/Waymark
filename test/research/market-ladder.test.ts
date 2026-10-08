import { describe, expect, it } from "vitest";
import { buildLadder, type Classified, type LadderVacancy } from "../../src/research/market/ladder";

const v = (id: string, title: string, salary?: number): LadderVacancy => ({
  id, title, url: `https://jobs.example/${id}`, description: "", country: "DE", city: "Berlin",
  ...(salary ? { salary: { min: salary, max: salary, currency: "EUR", period: "year" as const } } : {}),
});

describe("career ladder", () => {
  const vs = [v("1", "Junior Developer (m/w/d)", 45000), v("2", "Junior Developer", 48000), v("3", "junior developer", 50000), v("4", "Senior Developer"), v("5", "Head of Engineering")];
  const levels = new Map<string, Classified>([
    ["1", { level: "junior", minYears: 0 }], ["2", { level: "junior", minYears: 1 }], ["3", { level: "junior" }],
    ["4", { level: "senior", minYears: 5 }], ["5", { level: "lead", minYears: 8 }],
  ]);
  const ladder = buildLadder(vs, levels);

  it("lists only the levels the ads show, in order", () => {
    expect(ladder.map((s) => s.level)).toEqual(["junior", "senior", "lead"]);
  });

  it("uses the most common title and the experience range the ads ask for", () => {
    expect(ladder[0]).toMatchObject({ title: "Junior Developer", typicalExperienceYears: { min: 0, max: 1 } });
    expect(ladder[1]?.typicalExperienceYears).toEqual({ min: 5, max: undefined });
  });

  it("gives a salary only with at least 3 sourced ads, never an estimate", () => {
    expect(ladder[0]?.salary).toMatchObject({ median: 48000, currency: "EUR", period: "year", sampleSize: 3 });
    expect(ladder[1]?.salary).toBeUndefined();
    expect(ladder.every((s) => s.claims.every((c) => c.sources.length > 0))).toBe(true);
  });
});
