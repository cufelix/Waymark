// Shared fake inputs for Part 3 tests: one finished run for a junior backend developer in Prague.
// Obviously fake data (example.com, "Jane Example"). Use these in every src/gap test so the modules agree.
import type { CareerPath, Company, JobMarket, OccupationTrends, ResearchRunHead, SeekerProfile, SeekerResearch, Skill, Source, Vacancy } from "../contracts.ts";

const at = "2026-10-08T21:00:00Z";
const src = (url: string, quote: string): Source => ({ id: `src_${url.length}${quote.length}`, url, title: "Example ad", fetchedAt: at, tool: "apify", quote, contentHash: "0".repeat(64) });

export const OCC = { uri: "http://data.europa.eu/esco/occupation/example-backend", label: "backend developer", lang: "en" };
export const DOCKER: Skill = { uri: "http://data.europa.eu/esco/skill/example-docker", label: "Docker", lang: "en" };
export const POSTGRES: Skill = { uri: "http://data.europa.eu/esco/skill/example-postgresql", label: "PostgreSQL", lang: "en" };
export const K8S: Skill = { uri: "http://data.europa.eu/esco/skill/example-kubernetes", label: "Kubernetes", lang: "en" };

const vac = (id: string, companyId: string, title: string, reqs: [Skill, boolean, string][], extra: Partial<Vacancy> = {}): Vacancy => ({
  id, companyId, canonicalUrl: `https://jobs.example.com/${id}`, title, lang: "en", occupation: OCC,
  location: { country: "CZ", city: "Prague", remote: false },
  requirements: reqs.map(([skill, required, quote]) => ({ skill, required, source: src(`https://jobs.example.com/${id}`, quote) })),
  firstSeenAt: "2026-09-01T00:00:00Z", lastSeenAt: "2026-10-08T00:00:00Z", repostCount: 0, ...extra,
});

export const VACANCIES: Vacancy[] = [
  vac("vac_1", "cmp_dream", "Junior Backend Developer", [[DOCKER, true, "You know Docker."], [POSTGRES, true, "Experience with PostgreSQL."]]),
  vac("vac_2", "cmp_dream", "Backend Developer", [[DOCKER, true, "Docker in production."], [K8S, false, "Kubernetes is a plus."]], { repostCount: 2 }),
  vac("vac_3", "cmp_other", "Senior Backend Engineer", [[K8S, true, "Run services on Kubernetes."], [POSTGRES, true, "Deep PostgreSQL tuning."]], { firstSeenAt: "2026-06-01T00:00:00Z" }),
  vac("vac_4", "cmp_other", "Backend Developer (no experience needed)", [[DOCKER, false, "Docker is nice to have."]], {
    salary: { min: 45000, max: 60000, currency: "CZK", period: "month", source: src("https://jobs.example.com/vac_4", "45 000 - 60 000 CZK per month") },
  }),
];

export const COMPANIES: Company[] = [
  { id: "cmp_dream", name: "Example Dream s.r.o.", domain: "dream.example.com", country: "CZ", registryIds: [], isDreamCompany: true, claims: [], ghostSignals: [] },
  { id: "cmp_other", name: "Other Example a.s.", domain: "other.example.com", country: "CZ", registryIds: [], isDreamCompany: false, claims: [], ghostSignals: [] },
];

export const MARKET: JobMarket[] = [{
  occupation: OCC, location: { country: "CZ", city: "Prague" }, vacancyCount: 4,
  skillDemand: [
    { skill: DOCKER, vacanciesRequiring: 3, vacanciesTotal: 4, sources: [] },
    { skill: POSTGRES, vacanciesRequiring: 2, vacanciesTotal: 4, sources: [] },
    { skill: K8S, vacanciesRequiring: 2, vacanciesTotal: 4, sources: [] },
  ],
  salaryRange: { p25: 50000, median: 60000, p75: 75000, currency: "CZK", period: "month", sampleSize: 12 },
}];

export const TRENDS: OccupationTrends = {
  occupation: OCC, then: { from: "2016-01-01T00:00:00Z", to: "2019-01-01T00:00:00Z" }, now: { from: "2025-10-01T00:00:00Z", to: "2026-10-01T00:00:00Z" },
  thenDocs: 20, nowDocs: 40,
  skills: [{ skill: K8S, thenShare: 0.1, nowShare: 0.5, trend: "rising", sources: [] }, { skill: DOCKER, thenShare: 0.6, nowShare: 0.7, trend: "stable", sources: [] }],
};

export const CAREER_PATHS: CareerPath[] = [{
  occupation: OCC, why: [], vacancyCount: 4,
  ladder: [{ level: "junior", title: "Junior backend developer", claims: [] }, { level: "senior", title: "Senior backend developer", claims: [] }],
}];

export const RUN: ResearchRunHead = { runId: "run_EXAMPLE", seekerId: "skr_EXAMPLE", profileVersion: 3, status: "done" };

// Part 1 profile: PostgreSQL stated with a stub URI (so matching must fall back to the label), consent given.
export const PROFILE: SeekerProfile = {
  seekerId: "skr_EXAMPLE", profileVersion: 3, status: "complete",
  consent: { dataProcessing: true, nameSearch: false, givenAt: at, policyVersion: "test" },
  preferences: { targetOccupations: [OCC], locations: [{ country: "CZ", city: "Prague" }], remote: "ok", goal: "learn-fast", dreamCompanies: [{ name: "Example Dream s.r.o." }], dealBreakers: [], languages: [] },
  statedSkills: [{
    id: "clm_stated_pg", subject: { kind: "seeker", id: "skr_EXAMPLE" }, statement: "Has used PostgreSQL",
    skill: { uri: "urn:stub:skill:postgresql", label: "PostgreSQL", lang: "en" }, kind: "fact", tier: "stated",
    sources: [{ id: "src_cv", url: "seeker-upload://doc_EXAMPLE", title: "CV", fetchedAt: at, tool: "seeker-upload", quote: "PostgreSQL", contentHash: "1".repeat(64) }],
  }],
  documents: [], links: [], updatedAt: at,
};

// Part 2 user research: Docker proven by a confirmed link; Kubernetes only on an unconfirmed link (must not count as proven).
export const SEEKER_RESEARCH: SeekerResearch = {
  links: [
    { linkId: "lnk_gh", platform: "github", status: "extracted", ownership: "confirmed", reachable: true, fetchedAt: at, provenSkills: [{
      id: "clm_proven_docker", subject: { kind: "seeker", id: "skr_EXAMPLE" }, statement: "Has a public project using Docker", skill: DOCKER,
      kind: "fact", tier: "single-source", sources: [{ id: "src_gh", url: "https://github.example.com/jane-example/app", title: "app", fetchedAt: at, tool: "seeker-link", quote: "FROM node:22", contentHash: "2".repeat(64) }],
    }] },
    { linkId: "lnk_web", platform: "web", status: "extracted", ownership: "unconfirmed", reachable: true, fetchedAt: at, provenSkills: [{
      id: "clm_unconf_k8s", subject: { kind: "seeker", id: "skr_EXAMPLE" }, statement: "Mentions Kubernetes", skill: K8S,
      kind: "fact", tier: "single-source", sources: [{ id: "src_web", url: "https://jane.example.com", title: "site", fetchedAt: at, tool: "seeker-link", quote: "Kubernetes", contentHash: "3".repeat(64) }],
    }] },
  ],
};
