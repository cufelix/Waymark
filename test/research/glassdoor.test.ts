import { describe, expect, it } from "vitest";
import { reviewClaims } from "../../src/research/market/glassdoor";

describe("Glassdoor review claims", () => {
  const now = new Date("2026-10-09T00:00:00Z");
  const r = (overall: number, recommend: string, date: string, pros = "Great colleagues and learning", cons = "Long hours in busy seasons") =>
    ({ reviewId: Math.random(), reviewDateTime: date, ratingOverall: overall, ratingWorkLifeBalance: overall, ratingRecommendToFriend: recommend, pros, cons });

  it("averages only recent reviews, with sources and verbatim quotes", () => {
    const claims = reviewClaims("cmp_x", "https://www.glassdoor.com/Reviews/X-Reviews-E1.htm", [
      r(4, "POSITIVE", "2026-09-01"), r(2, "NEGATIVE", "2026-08-01"), r(5, "POSITIVE", "2026-07-01"), r(1, "NEGATIVE", "2019-01-01"),
    ], now);
    const s = claims.map((c) => c.statement);
    expect(s).toContain("Glassdoor: 3.7/5 average over 3 reviews from the last two years");
    expect(s).toContain("Glassdoor: 67% of 3 recent reviewers would recommend working here");
    expect(claims.every((c) => c.sources.length > 0 && c.sources[0]!.url.includes("glassdoor"))).toBe(true);
    expect(claims.find((c) => c.statement.startsWith("Employees praise"))?.sources[0]?.quote).toBe("Great colleagues and learning");
  });

  it("returns nothing when all reviews are old", () => {
    expect(reviewClaims("cmp_x", "u", [r(5, "POSITIVE", "2018-01-01")], now)).toEqual([]);
  });
});
