// Part 1 (user input) types, copied verbatim from API.md "Types".
// Temporary home until @cufelix lands src/contracts.ts; then this file re-exports from there.
// The field names are the contract: change API.md first, then this file.

// ---------- shared ----------
export type ISODate = string; // "2026-10-08T21:00:00Z"
export type Country = string; // ISO 3166-1 alpha-2, "CZ"
export type EscoUri = string; // "http://data.europa.eu/esco/occupation/…"

export type Source = {
  id: string; // "src_…"
  url: string; // web URL, or seeker-upload://… / seeker-interview://…
  title: string;
  fetchedAt: ISODate;
  tool: "apify" | "firecrawl" | "exa" | "registry" | "seeker-upload" | "seeker-link" | "seeker-interview";
  quote?: string; // must appear verbatim in the stored snapshot
  contentHash: string;
  snapshotKey?: string;
};

export type Claim = {
  id: string; // "clm_…"
  subject: { kind: "company" | "vacancy" | "seeker"; id: string };
  statement: string;
  skill?: Skill;
  kind: "fact" | "inference";
  tier: "verified" | "corroborated" | "single-source" | "contradicted" | "stated";
  sources: Source[]; // a claim without sources is never returned
  validUntil?: ISODate;
};

export type Occupation = { uri: EscoUri; label: string; lang: string };
export type Skill = { uri: EscoUri; label: string; lang: string };

// ---------- Part 1: user input ----------
export type Consent = {
  dataProcessing: true; // required
  nameSearch: boolean;
  givenAt: ISODate;
  policyVersion: string;
};

export type CareerPreferences = {
  targetOccupations: Occupation[]; // at least 1 for a complete profile
  locations: { country: Country; city?: string }[];
  remote: "only" | "ok" | "no";
  goal: "learn-fast" | "stability" | "mission";
  dreamCompanies: { name: string; url?: string }[];
  dealBreakers: string[];
  languages: { lang: string; level: "basic" | "working" | "fluent" | "native" }[];
  salaryExpectation?: { min: number; currency: string; period: "month" | "year" };
};

export type CareerPreferencesDraft = Partial<CareerPreferences>;

export type InterviewTurn = { role: "agent" | "seeker"; text: string; at: ISODate; sources?: Source[] };

export type SeekerDocument = {
  id: string; // "doc_…"
  kind: "cv";
  fileName: string;
  uploadedAt: ISODate;
  statedSkills: Claim[]; // tier "stated", source tool "seeker-upload"
  experience: { title: string; organisation?: string; from?: string; to?: string }[];
  education: { title: string; institution?: string; from?: string; to?: string }[];
};

export type SeekerLinkInput = {
  url: string;
  kind: "portfolio" | "github" | "linkedin" | "social" | "certificate" | "publication" | "other";
};
export type SeekerLink = SeekerLinkInput & { id: string; addedAt: ISODate }; // "lnk_…"

export type SeekerProfile = {
  seekerId: string; // "skr_…"
  profileVersion: number; // +1 on every change
  status: "incomplete" | "complete";
  consent: Consent;
  preferences: CareerPreferences;
  statedSkills: Claim[]; // merged from CV and interview, tier "stated"
  documents: SeekerDocument[];
  links: SeekerLink[];
  careerChoice?: CareerChoice; // set once the seeker picks one of a run's career paths
  updatedAt: ISODate;
};

export type CareerChoice = {
  occupation: Occupation; // one of the run's CareerPath.occupation
  runId: string; // the run whose career paths were shown
  chosenAt: ISODate;
};

// ResearchRun is Part 2's type; Part 1 only passes it through in the export.
export type SeekerExport = { profile: SeekerProfile; interview: InterviewTurn[]; researchRuns: unknown[] };

// ---------- Part 2: research ----------
export type CareerPath = {
  occupation: Occupation;
  why: Claim[]; // sourced reasons, e.g. demand in the seeker's locations
  vacancyCount: number; // in the seeker's locations
  ladder?: CareerStep[]; // ordered from entry to the top; absent until the run has found it
  // no fit score: order comes from market demand and the seeker's goal, never from how "good" the seeker is
};

export type CareerStep = {
  level: "entry" | "junior" | "mid" | "senior" | "lead" | "executive";
  title: string; // "Junior backend developer", "Chief technology officer"
  occupation?: Occupation; // only when the step is its own ESCO occupation (e.g. chief technology officer)
  typicalExperienceYears?: { min: number; max?: number }; // from the ads' requirements, e.g. "5+ years"
  salary?: { // omitted when no source gives one; never estimated without a source
    p25?: number; median: number; p75?: number;
    currency: string;
    period: "month" | "year";
    sampleSize: number;
    location: { country: Country; city?: string };
  };
  claims: Claim[]; // sources for the step, its experience and its salary (job ads, salary sites);
  // a ladder shape drawn from those ads is kind "inference"
};
