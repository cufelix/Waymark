// Types from API.md. Field names are the contract between Part 1 and Part 2.
// Zod schemas validate what arrives over HTTP; the types are inferred from them.
import { z } from "zod";

const ISODate = z.string().min(1);
const Country = z.string().regex(/^[A-Z]{2}$/);
const EscoUri = z.string().min(1);

export const SourceTool = z.enum([
  "apify", "firecrawl", "exa", "registry", "fetch", "official-api",
  "seeker-upload", "seeker-link", "seeker-interview",
]);

export const Source = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  fetchedAt: ISODate,
  tool: SourceTool,
  quote: z.string().optional(),
  contentHash: z.string(),
  snapshotKey: z.string().optional(),
});
export type Source = z.infer<typeof Source>;

export const Occupation = z.object({ uri: EscoUri, label: z.string(), lang: z.string() });
export type Occupation = z.infer<typeof Occupation>;
export const Skill = Occupation;
export type Skill = z.infer<typeof Skill>;

export const Claim = z.object({
  id: z.string(),
  subject: z.object({ kind: z.enum(["company", "vacancy", "seeker"]), id: z.string() }),
  statement: z.string(),
  skill: Skill.optional(),
  kind: z.enum(["fact", "inference"]),
  tier: z.enum(["verified", "corroborated", "single-source", "contradicted", "stated"]),
  sources: z.array(Source).min(1),
  validUntil: ISODate.optional(),
});
export type Claim = z.infer<typeof Claim>;

// ---------- Part 1: user input (received as a whole SeekerProfile) ----------
export const Consent = z.object({
  dataProcessing: z.literal(true),
  nameSearch: z.boolean(),
  givenAt: ISODate,
  policyVersion: z.string(),
});

export const CareerPreferences = z.object({
  targetOccupations: z.array(Occupation),
  locations: z.array(z.object({ country: Country, city: z.string().optional() })),
  remote: z.enum(["only", "ok", "no"]),
  goal: z.enum(["learn-fast", "stability", "mission"]),
  dreamCompanies: z.array(z.object({ name: z.string().min(1), url: z.string().optional() })),
  dealBreakers: z.array(z.string()),
  languages: z.array(z.object({ lang: z.string(), level: z.enum(["basic", "working", "fluent", "native"]) })),
  salaryExpectation: z
    .object({ min: z.number(), currency: z.string(), period: z.enum(["month", "year"]) })
    .optional(),
});
export type CareerPreferences = z.infer<typeof CareerPreferences>;

export const SeekerDocument = z.object({
  id: z.string(),
  kind: z.string(),
  fileName: z.string(),
  uploadedAt: ISODate,
  statedSkills: z.array(Claim),
  experience: z.array(z.object({ title: z.string(), organisation: z.string().optional(), from: z.string().optional(), to: z.string().optional() })),
  education: z.array(z.object({ title: z.string(), institution: z.string().optional(), from: z.string().optional(), to: z.string().optional() })),
});

export const SeekerLink = z.object({
  id: z.string(),
  url: z.string().url(),
  kind: z.string().optional(), // Part 2 detects the platform itself
  addedAt: ISODate,
});
export type SeekerLink = z.infer<typeof SeekerLink>;

export const SeekerProfile = z.object({
  seekerId: z.string().startsWith("skr_"),
  profileVersion: z.number().int().nonnegative(),
  status: z.enum(["incomplete", "complete"]),
  consent: Consent,
  preferences: CareerPreferences,
  statedSkills: z.array(Claim),
  documents: z.array(SeekerDocument),
  links: z.array(SeekerLink),
  careerChoice: z.object({ occupation: Occupation, runId: z.string(), chosenAt: ISODate }).optional(),
  updatedAt: ISODate,
});
export type SeekerProfile = z.infer<typeof SeekerProfile>;

// ---------- Part 2: research ----------
export const ResearchSources = z.enum(["apify", "firecrawl", "exa", "registry"]);

export const ResearchOptions = z.strictObject({
  maxCompanies: z.number().int().positive().max(500).default(50),
  maxVacancies: z.number().int().positive().max(5000).default(500),
  sources: z.array(ResearchSources).default(["apify", "firecrawl", "exa", "registry"]),
  nameSearch: z.boolean().default(false),
});
export type ResearchOptions = z.infer<typeof ResearchOptions>;

export const StartRunBody = z.strictObject({
  profile: SeekerProfile,
  options: ResearchOptions.optional(),
});

export type RunStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export type RunStep = "career-paths" | "companies" | "vacancies" | "market" | "seeker-research";

export type CareerStep = {
  level: "entry" | "junior" | "mid" | "senior" | "lead" | "executive";
  title: string;
  occupation?: Occupation;
  typicalExperienceYears?: { min: number; max?: number };
  salary?: {
    p25?: number; median: number; p75?: number;
    currency: string; period: "month" | "year";
    sampleSize: number;
    location: { country: string; city?: string };
  };
  claims: Claim[];
};

export type CareerPath = {
  occupation: Occupation;
  why: Claim[];
  vacancyCount: number;
  ladder?: CareerStep[];   // entry to top; only the steps today's ads actually show
};

export type Company = {
  id: string;
  name: string;
  domain?: string;
  country: string;
  registryIds: { scheme: string; id: string }[];
  isDreamCompany: boolean;
  claims: Claim[];
  ghostSignals: Claim[];
};

export type Vacancy = {
  id: string;
  companyId: string;
  canonicalUrl: string;
  title: string;
  lang: string;
  occupation: Occupation;
  location: { country: string; city?: string; remote: boolean };
  requirements: { skill: Skill; required: boolean; source: Source }[];
  salary?: { min?: number; max?: number; currency: string; period: "month" | "year"; source: Source };
  postedAt?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  repostCount: number;
};

export type VacancySighting = { seenAt: string; url: string; contentHash: string; source: "apify" | "firecrawl" | "exa" };

export type JobMarket = {
  occupation: Occupation;
  location: { country: string; city?: string };
  vacancyCount: number;
  skillDemand: { skill: Skill; vacanciesRequiring: number; vacanciesTotal: number; sources: Source[] }[];
  salaryRange?: { p25: number; median: number; p75: number; currency: string; period: "month" | "year"; sampleSize: number };
};

export type SeekerResearchLink = {
  linkId: string;
  platform: string;
  status: "extracted" | "partial" | "unsupported" | "failed";
  reason?: string;
  ownership: "confirmed" | "unconfirmed";
  reachable: boolean;
  fetchedAt: string;
  provenSkills: Claim[];
};

export type SeekerResearch = {
  links: SeekerResearchLink[];
  nameSearch?: { candidates: { url: string; title: string; snippet: string }[] };
};

/** How demand for a skill in one occupation changed between about ten years ago and the last 12 months. */
export type SkillTrend = {
  skill: Skill;
  thenShare: number;
  nowShare: number;
  trend: "rising" | "stable" | "fading";
  sources: Source[];
};

export type OccupationTrends = {
  occupation: Occupation;
  then: { from: string; to: string };
  now: { from: string; to: string };
  thenDocs: number;
  nowDocs: number;
  skills: SkillTrend[];
};

/** A kind of project people at the target companies build now; examples are links to public repos. */
export type ProjectTheme = { theme: string; description: string; skills: string[]; roleModels: number; examples: Source[] };

export type TechTrend = { name: string; kind: "language" | "topic"; nowShare: number; thenShare: number; trend: "rising" | "stable" | "fading" };

/** Aggregates only: counts of role models and links to public repos, never a list of people. */
export type RoleModelInsights = {
  occupation: Occupation;
  platform: "github" | "web";      // where this occupation's work was read, chosen per occupation
  sites: string[];                 // e.g. ["github.com"] or ["behance.net", "dribbble.com"]
  companies: { name: string; githubOrg: string; roleModels: number }[];
  roleModelsRead: number;
  window: { nowSince: string; thenBefore: string };
  themesNow: ProjectTheme[];
  techTrends: TechTrend[];
};

export type ResearchResult = {
  careerPaths: CareerPath[];
  trends: OccupationTrends[];
  roleModels?: RoleModelInsights[];
  companyIds: string[];
  vacancyIds: string[];
  market: JobMarket[];
  seekerResearch: SeekerResearch;
};

export type ResearchRun = {
  runId: string;
  seekerId: string;
  profileVersion: number;
  status: RunStatus;
  progress: { step: RunStep; done: number; total: number }[];
  startedAt?: string;
  finishedAt?: string;
  error?: { code: string; message: string };
  result?: ResearchResult;
  cost: { tool: string; units: number; usd: number }[];
};

export type ResearchRunExport = ResearchRun & {
  storedInput: { profile: SeekerProfile; options: ResearchOptions };
  artifacts: {
    artifactId: string;
    inputId: string;
    data: unknown;
    createdAt: string;
  }[];
  costLedger: {
    at: string;
    tool: string;
    units: number;
    usd: number;
    detail?: string;
  }[];
};
