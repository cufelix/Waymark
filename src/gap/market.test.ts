import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { Source, Vacancy } from "./contracts.ts";
import { buildMarketFacts } from "./market.ts";
import { DOCKER, MARKET, OCC, VACANCIES } from "./testdata/run.ts";

const NOW = new Date("2026-10-09T00:00:00Z");

function source(url: string, quote: string): Source {
  return {
    id: `src_${createHash("sha256").update(`${url}\0${quote}`).digest("hex")}`,
    url,
    title: "Example ad",
    fetchedAt: "2026-10-08T00:00:00Z",
    tool: "apify",
    quote,
    contentHash: createHash("sha256").update(quote).digest("hex"),
  };
}

function vacancy(input: Partial<Vacancy> & Pick<Vacancy, "id" | "title">): Vacancy {
  return {
    id: input.id,
    companyId: "cmp_example",
    canonicalUrl: `https://jobs.example.com/${input.id}`,
    title: input.title,
    lang: "en",
    occupation: OCC,
    location: { country: "CZ", city: "Prague", remote: false },
    requirements: [],
    firstSeenAt: "2026-10-01T00:00:00Z",
    lastSeenAt: "2026-10-08T00:00:00Z",
    repostCount: 0,
    ...input,
  };
}

test("builds Prague market facts from the shared run and keeps an empty location factual", () => {
  const facts = buildMarketFacts({
    vacancies: VACANCIES,
    market: MARKET,
    locations: [{ country: "CZ", city: "Prague" }, { country: "SK", city: "Bratislava" }],
    now: NOW,
  });

  assert.equal(facts.length, 2);
  assert.deepEqual(facts[0], {
    location: { country: "CZ", city: "Prague" },
    openVacancies: 4,
    entryLevelVacancies: 2,
    entryLevelSources: [
      {
        id: facts[0]?.entryLevelSources[0]?.id,
        url: VACANCIES[0]?.canonicalUrl,
        title: "Junior Backend Developer",
        fetchedAt: VACANCIES[0]?.firstSeenAt,
        tool: "apify",
        quote: "Junior Backend Developer",
        contentHash: createHash("sha256").update("Junior Backend Developer").digest("hex"),
      },
      {
        id: facts[0]?.entryLevelSources[1]?.id,
        url: VACANCIES[3]?.canonicalUrl,
        title: "Backend Developer (no experience needed)",
        fetchedAt: VACANCIES[3]?.firstSeenAt,
        tool: "apify",
        quote: "Backend Developer (no experience needed)",
        contentHash: createHash("sha256").update("Backend Developer (no experience needed)").digest("hex"),
      },
    ],
    medianDaysOpen: 37,
    repostedVacancies: 1,
    salaryRange: MARKET[0]?.salaryRange,
  });
  assert.match(facts[0]?.entryLevelSources[0]?.id ?? "", /^src_[0-9a-f]+$/);
  assert.match(facts[0]?.entryLevelSources[1]?.id ?? "", /^src_[0-9a-f]+$/);
  assert.deepEqual(facts[1], {
    location: { country: "SK", city: "Bratislava" },
    openVacancies: 0,
    entryLevelVacancies: 0,
    entryLevelSources: [],
    repostedVacancies: 0,
  });
});

test("recognises Czech requirement wording and German title wording without matching word fragments", () => {
  const czechSource = source("https://jobs.example.com/cz-entry", "Pozice je vhodná i bez praxe.");
  const vacancies = [
    vacancy({
      id: "vac_cz_entry",
      title: "Backend vývojář",
      location: { country: "CZ", city: "Brno", remote: false },
      requirements: [{ skill: DOCKER, required: false, source: czechSource }],
    }),
    vacancy({
      id: "vac_de_entry",
      title: "Berufseinsteiger Backend-Entwickler",
      location: { country: "DE", city: "Berlin", remote: false },
    }),
    vacancy({
      id: "vac_not_entry",
      title: "Senior specialist in graduateability metrics",
      location: { country: "DE", city: "Berlin", remote: false },
    }),
  ];

  const [brno, berlin] = buildMarketFacts({
    vacancies,
    market: [],
    locations: [{ country: "CZ", city: "brNO" }, { country: "DE", city: "BERLIN" }],
    now: NOW,
  });

  assert.equal(brno?.entryLevelVacancies, 1);
  assert.deepEqual(brno?.entryLevelSources, [czechSource]);
  assert.equal(berlin?.entryLevelVacancies, 1);
  assert.equal(berlin?.entryLevelSources[0]?.quote, "Berufseinsteiger Backend-Entwickler");
});

test("counts remote vacancies for every city in their country and uses an inclusive 14-day window", () => {
  const vacancies = [
    vacancy({
      id: "vac_remote",
      title: "Backend Developer",
      location: { country: "CZ", city: "Ostrava", remote: true },
      firstSeenAt: "2026-09-16T00:00:00Z",
      lastSeenAt: "2026-09-25T00:00:00Z",
    }),
    vacancy({
      id: "vac_other_city",
      title: "Backend Developer",
      location: { country: "CZ", city: "Brno", remote: false },
      lastSeenAt: "2026-10-08T00:00:00Z",
    }),
    vacancy({
      id: "vac_stale_remote",
      title: "Backend Developer",
      location: { country: "CZ", remote: true },
      firstSeenAt: "2026-09-15T23:59:59Z",
      lastSeenAt: "2026-09-24T23:59:59Z",
    }),
  ];

  const [prague, country] = buildMarketFacts({
    vacancies,
    market: [],
    locations: [{ country: "CZ", city: "Prague" }, { country: "CZ" }],
    now: NOW,
  });

  assert.equal(prague?.openVacancies, 1);
  assert.equal(prague?.medianDaysOpen, 9);
  assert.equal(country?.openVacancies, 2);
  assert.equal(country?.medianDaysOpen, 9);
});

test("returns stable title-source IDs", () => {
  const input = { vacancies: [VACANCIES[0]!], market: MARKET, locations: [{ country: "CZ", city: "Prague" }], now: NOW };

  const first = buildMarketFacts(input)[0]?.entryLevelSources[0]?.id;
  const second = buildMarketFacts(input)[0]?.entryLevelSources[0]?.id;

  assert.equal(first, second);
});
