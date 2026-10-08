import assert from "node:assert/strict";
import test from "node:test";
import type { JobMarket, Skill, Source, Vacancy } from "./contracts.ts";
import { buildJobProfile } from "./job-profile.ts";
import { CAREER_PATHS, DOCKER, K8S, MARKET, OCC, POSTGRES, TRENDS, VACANCIES } from "./testdata/run.ts";

test("buildJobProfile generalizes the shared vacancy data", () => {
  const profile = buildJobProfile({
    occupation: OCC,
    vacancies: VACANCIES,
    market: MARKET,
    trends: TRENDS,
    careerPath: CAREER_PATHS[0],
  });

  assert.equal(profile.occupation, OCC);
  assert.equal(profile.vacanciesAnalysed, 4);
  assert.deepEqual(profile.markets, [{ country: "CZ", city: "Prague", vacancies: 4 }]);
  assert.deepEqual(profile.salaryRange, MARKET[0].salaryRange);
  assert.equal(profile.ladder, CAREER_PATHS[0].ladder);
  assert.equal(profile.summary, undefined);

  const docker = profile.skills.find(({ skill }) => skill.uri === DOCKER.uri);
  assert.ok(docker);
  assert.equal(docker.vacanciesRequiring, 3);
  assert.equal(docker.vacanciesTotal, 4);
  assert.equal(docker.band, "most");
  assert.equal(docker.trend, "stable");
  assert.deepEqual(docker.sources.map(({ quote }) => quote), ["You know Docker.", "Docker in production.", "Docker is nice to have."]);

  const kubernetes = profile.skills.find(({ skill }) => skill.uri === K8S.uri);
  assert.ok(kubernetes);
  assert.equal(kubernetes.vacanciesRequiring, 2);
  assert.equal(kubernetes.band, "most");
  assert.equal(kubernetes.trend, "rising");
  assert.deepEqual(kubernetes.sources.map(({ quote }) => quote), ["Kubernetes is a plus.", "Run services on Kubernetes."]);

  const postgres = profile.skills.find(({ skill }) => skill.uri === POSTGRES.uri);
  assert.ok(postgres);
  assert.equal(postgres.vacanciesRequiring, 2);
  assert.equal(postgres.band, "most");
  assert.deepEqual(profile.skills.map(({ skill }) => skill.label), ["Docker", "Kubernetes", "PostgreSQL"]);
});

test("buildJobProfile matches fallback labels, counts each vacancy once, and deduplicates sources", () => {
  const firstSkill: Skill = { uri: "urn:stub:skill:cafe-tools", label: "Café tools", lang: "en" };
  const equivalentSkill: Skill = { uri: "http://data.europa.eu/esco/skill/example-cafe", label: "Cafe---tools", lang: "en" };
  const sharedSource: Source = {
    id: "src_one",
    url: "https://jobs.example.com/fallback",
    title: "Example ad",
    fetchedAt: "2026-10-08T21:00:00Z",
    tool: "apify",
    quote: "Use Cafe tools.",
    contentHash: "a".repeat(64),
  };
  const vacancy: Vacancy = {
    ...VACANCIES[0],
    id: "vac_fallback",
    location: { country: "DE", remote: true },
    requirements: [
      { skill: firstSkill, required: true, source: sharedSource },
      { skill: equivalentSkill, required: false, source: { ...sharedSource, id: "src_duplicate" } },
    ],
  };

  const profile = buildJobProfile({
    occupation: OCC,
    vacancies: [vacancy],
    market: [],
    trends: { ...TRENDS, skills: [{ skill: equivalentSkill, thenShare: 0.1, nowShare: 0.3, trend: "rising", sources: [] }] },
  });

  assert.deepEqual(profile.markets, [{ country: "DE", vacancies: 1 }]);
  assert.equal(profile.skills.length, 1);
  assert.equal(profile.skills[0].vacanciesRequiring, 1);
  assert.equal(profile.skills[0].band, "most");
  assert.equal(profile.skills[0].trend, "rising");
  assert.deepEqual(profile.skills[0].sources, [sharedSource]);
});

test("buildJobProfile uses the salary range with the largest sample", () => {
  const market: JobMarket[] = [
    { ...MARKET[0], salaryRange: { ...MARKET[0].salaryRange!, median: 55000, sampleSize: 8 } },
    { ...MARKET[0], location: { country: "DE", city: "Berlin" }, salaryRange: { p25: 60000, median: 70000, p75: 80000, currency: "EUR", period: "year", sampleSize: 20 } },
    { ...MARKET[0], location: { country: "AT", city: "Vienna" }, salaryRange: undefined },
  ];

  const profile = buildJobProfile({ occupation: OCC, vacancies: VACANCIES, market });

  assert.deepEqual(profile.salaryRange, market[1].salaryRange);
});

test("buildJobProfile handles no vacancies", () => {
  const profile = buildJobProfile({ occupation: OCC, vacancies: [], market: [] });

  assert.equal(profile.vacanciesAnalysed, 0);
  assert.deepEqual(profile.markets, []);
  assert.deepEqual(profile.skills, []);
  assert.equal(profile.salaryRange, undefined);
  assert.equal(profile.ladder, undefined);
  assert.equal(profile.summary, undefined);
});
