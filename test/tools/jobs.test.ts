import { describe, expect, it } from "vitest";
import { inCountry, matches, SOURCES, stripHtml, type FreeJob } from "../../src/tools/jobs";

const job = (over: Partial<FreeJob>): FreeJob => ({
  source: "remoteok", id: "1", title: "Senior Backend Developer", company: "Acme", url: "https://x", description: "",
  location: "Worldwide", remote: true, tags: ["node"], ...over,
});

describe("free_jobs_search", () => {
  it("strips HTML and entities", () => {
    expect(stripHtml("<p>Hi &amp; <b>welcome</b></p><script>x()</script><li>Docker</li>")).toBe("Hi & welcome\nDocker");
  });

  it("matches when at least half the query words appear in title or tags", () => {
    expect(matches(job({}), "backend developer")).toBe(true);
    expect(matches(job({ title: "Registered Nurse", tags: ["healthcare"] }), "backend developer")).toBe(false);
    expect(matches(job({ title: "Pflegefachkraft", tags: ["nurse"] }), "nurse")).toBe(true);
  });

  it("filters by country, letting unrestricted remote jobs through only when remote is allowed", () => {
    expect(inCountry(job({ country: "DE", remote: false }), "DE", false)).toBe(true);
    expect(inCountry(job({ country: "DE", remote: false }), "CZ", true)).toBe(false);
    expect(inCountry(job({ location: "Worldwide" }), "CZ", true)).toBe(true);
    expect(inCountry(job({ location: "Worldwide" }), "CZ", false)).toBe(false);
    expect(inCountry(job({ location: "Greece, Cyprus" }), "CZ", true)).toBe(false);
    expect(inCountry(job({ location: "Czechia, Slovakia" }), "CZ", true)).toBe(true);
  });

  it("normalises a RemoteOK item and skips its legal-notice first element", () => {
    const src = SOURCES.find((s) => s.name === "remoteok")!;
    const items = src.list([{ legal: "notice" }, { id: 7, position: "Nurse", company: "Care", url: "https://r/7", description: "<p>x</p>", tags: ["medical"], salary_min: 50000, salary_max: 0 }]);
    expect(items).toHaveLength(1);
    expect(src.map(items[0]!)).toMatchObject({ title: "Nurse", company: "Care", remote: true, salaryMin: 50000, salaryMax: undefined, currency: "USD", salaryPeriod: "year" });
  });
});
