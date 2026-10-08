// Types for Part 3 (Stage 3: validation), copied from API.md. The field names are the contract.
// Shared and Part 1 types come from src/seeker/contracts.ts; Part 2 types are copied here as Part 3 reads them.
import type { CareerPath, CareerStep, Claim, Country, EscoUri, ISODate, Occupation, SeekerProfile, Skill, Source } from "../seeker/contracts.ts";

export type { CareerPath, CareerStep, Claim, Country, EscoUri, ISODate, Occupation, SeekerProfile, Skill, Source };

// ---------- Part 2 types Part 3 reads (API.md "Types", Part 2) ----------
export type Company = {
  id: string;                     // "cmp_…"
  name: string;
  domain?: string;
  country: Country;
  registryIds: { scheme: string; id: string }[];   // "lei", "cz-ico", "uk-companies-house"…
  isDreamCompany: boolean;        // true when it came from the seeker's preferences
  claims: Claim[];                // registry facts, stated values, reviews, headcount
  ghostSignals: Claim[];          // always kind "inference"
};

export type Vacancy = {
  id: string;                     // "vac_…"
  companyId: string;
  canonicalUrl: string;
  title: string;
  lang: string;
  occupation: Occupation;
  location: { country: Country; city?: string; remote: boolean };
  requirements: { skill: Skill; required: boolean; source: Source }[];   // quote = the sentence in the ad
  salary?: { min?: number; max?: number; currency: string; period: "month" | "year"; source: Source };
  postedAt?: ISODate;
  firstSeenAt: ISODate;
  lastSeenAt: ISODate;
  repostCount: number;
};

export type JobMarket = {
  occupation: Occupation;
  location: { country: Country; city?: string };
  vacancyCount: number;
  skillDemand: { skill: Skill; vacanciesRequiring: number; vacanciesTotal: number; sources: Source[] }[];
  salaryRange?: { p25: number; median: number; p75: number; currency: string; period: "month" | "year"; sampleSize: number };
};

export type OccupationTrends = {
  occupation: Occupation;
  then: { from: ISODate; to: ISODate };   // about 10 to 7 years ago
  now: { from: ISODate; to: ISODate };    // the last 12 months
  thenDocs: number;                       // dated job ads and career articles read per era
  nowDocs: number;
  skills: {
    skill: Skill;
    thenShare: number;                    // share of then-era documents asking for it
    nowShare: number;                     // share of now-era documents or today's vacancies, whichever is higher
    trend: "rising" | "stable" | "fading";
    sources: Source[];                    // verbatim quotes from both eras
  }[];
};

export type SeekerResearch = {
  links: {
    linkId: string;
    platform: string;             // detected by Part 2: "github", "tiktok", "soundcloud", "web"…
    status: "extracted" | "partial" | "unsupported" | "failed";
    reason?: string;              // why partial, unsupported or failed, in plain words for the seeker
    ownership: "confirmed" | "unconfirmed";   // unconfirmed: skills stay tier "stated", never proof
    reachable: boolean;
    fetchedAt: ISODate;
    provenSkills: Claim[];        // what the page actually shows, tier "single-source" or better, source tool "seeker-link"
  }[];
  nameSearch?: {                  // only when consent.nameSearch is true
    candidates: { url: string; title: string; snippet: string }[];   // "may be you": never stored as claims until the seeker confirms
  };
};

// Only the fields Part 3 uses from GET /v1/research-runs/{runId}.
export type ResearchRunHead = { runId: string; seekerId: string; profileVersion: number; status: "queued" | "running" | "done" | "failed" | "cancelled" };

// ---------- Part 3 ----------
export type Evidence = "proven" | "stated" | "none";
                                  // proven: a provenSkills claim from a seeker link with ownership "confirmed"
                                  // stated: only in the CV or the interview (tier "stated"); none: nothing found

export type ValidationRequest = {
  profile: SeekerProfile;
  runId: string;
  occupationUri?: EscoUri;        // default: profile.careerChoice, else the first target occupation
};

export type Validation = {
  validationId: string;           // "val_…"
  seekerId: string;
  runId: string;
  profileVersion: number;
  createdAt: ISODate;
  occupation: Occupation;
  locations: { country: Country; city?: string }[];
  jobProfile: JobProfile;
  skills: SkillCheck[];           // ordered by employer demand, never by the seeker's evidence
  companies: CompanyCheck[];      // dream companies first, then by number of vacancies
  market: MarketFacts[];          // one per location
};

export type SalaryRange = { p25: number; median: number; p75: number; currency: string; period: "month" | "year"; sampleSize: number };

export type JobProfile = {               // the typical job across the seeker's locations
  occupation: Occupation;
  vacanciesAnalysed: number;
  markets: { country: Country; city?: string; vacancies: number }[];
  skills: {
    skill: Skill;
    vacanciesRequiring: number;
    vacanciesTotal: number;
    band: "most" | "many" | "some";   // most: at least half of the ads, many: 20-49 %, some: under 20 %
    trend?: "rising" | "stable" | "fading";
    trendSources?: Source[];      // the quotes the trend comes from
    sources: Source[];            // quotes from the ads
  }[];
  salaryRange?: SalaryRange;
  ladder?: CareerStep[];
  summary?: Claim;                // kind "inference": a plain description drawn from the ads, the ads as sources
};

export type SkillCheck = {
  skill: Skill;
  demand: {
    vacanciesRequiring: number;
    vacanciesTotal: number;
    companiesRequiring: number;   // "7 of 10 companies" describes companies, not the seeker
    companiesTotal: number;
    requiredIn: number;           // ads that mark it as required rather than nice-to-have
    sources: Source[];
  };
  evidence: Evidence;
  claims: Claim[];                // the seeker's own claims for this skill, stated and proven
  trend?: "rising" | "stable" | "fading";
  trendSources?: Source[];        // the quotes the trend comes from
};

export type CompanyCheck = {
  companyId: string;
  name: string;
  isDreamCompany: boolean;
  vacancyIds: string[];
  requirements: { skill: Skill; required: boolean; evidence: Evidence; source: Source }[];   // quote = the sentence in the ad
};

export type MarketFacts = {              // how open the market is; never a probability for the seeker
  location: { country: Country; city?: string };
  openVacancies: number;
  entryLevelVacancies: number;    // ads for juniors, trainees or people without experience (title or requirement quote)
  entryLevelSources: Source[];
  medianDaysOpen?: number;        // from firstSeenAt to lastSeenAt
  repostedVacancies: number;      // repostCount of at least 1
  salaryRange?: SalaryRange;
};
