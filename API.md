# API contract

The single source of truth for how the parts talk to each other. If an endpoint or a type changes, change it here first, in a PR both owners approve.

| Part (whiteboard) | Owner | Status |
|---|---|---|
| 1. User input: interview, career preferences, dream companies, CV, portfolio, GitHub and socials | @Dymyt-ry | building now, API only, no UI |
| 2. Research: user research, company research, vacancy listing, job market, top career paths | @cufelix | building now |
| 3. Validation: company requirements, requirement vs evidence per skill, the typical job across markets, market facts | @Dymyt-ry | building now |
| 4. Output: roadmap, curated resources | not assigned | names reserved below |

## How the parts connect

```mermaid
sequenceDiagram
    participant C as Client (UI later, curl now)
    participant P1 as Part 1: Input
    participant P2 as Part 2: Research
    C->>P1: POST /v1/seekers (consent)
    C->>P1: interview, preferences, CV, links
    C->>P1: GET /v1/seekers/{id}/profile
    P1-->>C: SeekerProfile (status "complete")
    C->>P2: POST /v1/research-runs { profile }
    P2-->>C: { runId, status "queued" }
    C->>P2: GET /v1/research-runs/{runId}/career-paths (while the run is still going)
    P2-->>C: top 3 CareerPath with ladder and salaries
    C->>P1: PUT /v1/seekers/{id}/career-choice { runId, occupationUri }
    C->>P2: GET /v1/research-runs/{runId}
    P2-->>C: ResearchResult (status "done")
```

**The handoff is one object: `SeekerProfile`.** Part 2 receives the whole profile in the request body, not a reference to it. Each part can be built and tested alone: Part 2 runs from a saved profile JSON file, and Part 1 needs Part 2 running only for the GDPR export and delete (below).

**Occupation and skill lookup is a shared module, not an endpoint.** `src/shared/taxonomy/` wraps the public ESCO API with a local cache, and both parts import it. @cufelix owns it. Part 1 uses it to turn "nurse" or "backend developer" into ESCO IDs, so there is no runtime call from Part 1 to Part 2 for it. Until it lands, Part 1 uses the stub in `src/shared/taxonomy/stub.ts`, which has the same function signatures and a few hard-coded entries.

**Part 1 calls Part 2 at runtime in two places:**
- The GDPR cascade: deleting or exporting a seeker also deletes or exports their research (see Part 1's export and delete endpoints).
- The career choice: Part 1 checks the chosen occupation against that run's `GET /v1/research-runs/{runId}/career-paths` before storing it.

## Conventions

- **Base path** `/v1`. A breaking change goes to `/v2`.
- **Auth:** `Authorization: Bearer <API key>` on every call. Keys come from environment variables, never from the repo. User login arrives with the UI.
- **JSON everywhere**, except the CV upload (`multipart/form-data`).
- **Response envelope**, the same on every endpoint:

  ```json
  { "ok": true,  "data": { }, "error": null, "meta": { "requestId": "req_…" } }
  { "ok": false, "data": null, "error": { "code": "not_found", "message": "Seeker skr_123 does not exist" }, "meta": { "requestId": "req_…" } }
  ```

  Lists add `meta.page`, `meta.pageSize`, `meta.total`, and take `?page=` and `?pageSize=` (max 100).
- **Error codes:** `bad_request` (400), `unauthorized` (401), `consent_required` (403), `not_found` (404), `conflict` (409), `unprocessable` (422, input fails validation), `rate_limited` (429), `upstream_failed` (502, a scraper or API failed), `internal` (500).
- **IDs** are prefixed strings: `skr_` seeker, `doc_` document, `lnk_` link, `run_` research run, `cmp_` company, `vac_` vacancy, `clm_` claim, `src_` source.
- **Standards:**
  - Timestamps: ISO 8601 UTC, `2026-10-08T21:00:00Z`.
  - Countries: ISO 3166-1 alpha-2, `CZ`.
  - Languages: BCP 47, `cs`.
  - Currencies: ISO 4217, `EUR`.
  - Occupations and skills: ESCO URIs.
- **Validation:** every request body is checked against the types below. Unknown fields are rejected with `unprocessable`.
- **Who mints IDs:** each part mints IDs for the objects it creates, as `prefix_` + ULID, so they are globally unique. Part 1 creates the `stated` claims and their sources; Part 2 keeps those IDs unchanged and mints its own for everything it finds.
- **Sources without a web URL** use an internal URI:
  - a CV: `seeker-upload://doc_…`
  - an interview turn: `seeker-interview://skr_…#turn-7`

  `contentHash` is the SHA-256 of the uploaded file or of the turn's text.

## Part 1: User input (@Dymyt-ry)

| Method and path | Does | Body | Returns |
|---|---|---|---|
| `POST /v1/seekers` | Create a seeker. Consent is required here. | `{ consent: Consent }` | `{ seekerId }` |
| `POST /v1/seekers/{seekerId}/interview/messages` | One turn of the intake interview. The agent asks; the client sends the seeker's answer. Send an empty `text` to get the first question. When the seeker asks about pay, the agent may run a quick salary lookup on the web and answer with an indicative range (see "Salary lookup in the interview" below). | `{ text: string }` (max 4,000 characters) | `{ reply: string, done: boolean, preferences: CareerPreferencesDraft, sources?: Source[] }` |
| `GET /v1/seekers/{seekerId}/interview` | Full interview transcript | | `InterviewTurn[]` |
| `PUT /v1/seekers/{seekerId}/preferences` | Set or correct preferences directly, without the interview. Must be complete. | `CareerPreferences` | `CareerPreferences` |
| `POST /v1/seekers/{seekerId}/documents` | Upload a CV (PDF or DOCX, max 10 MB). Parsed into stated skills. | multipart field `file` | `SeekerDocument` |
| `DELETE /v1/seekers/{seekerId}/documents/{documentId}` | Remove a CV and everything parsed from it | | `{ deleted: true }` |
| `PUT /v1/seekers/{seekerId}/links` | Replace the seeker's list of links (portfolio, GitHub, socials). Part 1 stores them; reading them is Part 2's user research. | `{ links: SeekerLinkInput[] }` | `SeekerLink[]` |
| `PUT /v1/seekers/{seekerId}/career-choice` | The seeker picks one of the run's career paths, usually while the rest of the research is still running. Part 1 accepts only an occupation that run returned (`unprocessable` otherwise), stores it as `profile.careerChoice` (profileVersion +1) and leaves `preferences` as they are. Calling it again replaces the choice. | `{ runId: string, occupationUri: EscoUri }` | `CareerChoice` |
| `GET /v1/seekers/{seekerId}/profile` | **The handoff object.** `status` is `"complete"` once preferences have at least one target occupation and consent is given. | | `SeekerProfile` |
| `GET /v1/seekers/{seekerId}/export` | Everything stored about the seeker in both parts (GDPR). Part 1 adds the runs from Part 2's `GET /v1/seekers/{seekerId}/research-runs`. | | `SeekerExport` |
| `DELETE /v1/seekers/{seekerId}` | Hard delete in both parts (GDPR). Part 1 calls Part 2's `DELETE /v1/seekers/{seekerId}/research` first. If that fails, it answers `upstream_failed`, marks the seeker `deletion-pending` and retries until both are gone. | | `{ deleted: true }` |

### Salary lookup in the interview

Seekers ask "what does this pay?" during the interview, long before the research run has market data. The agent can answer with a quick web lookup instead of putting them off:

- **When:** only when the seeker asks about pay for an occupation. At most 2 lookups per interview.
- **How:**
  - One Exa search (`POST https://api.exa.ai/search`, header `x-api-key` from env `EXA_API_KEY`, `numResults` 5, `contents.text`) for the occupation and the seeker's location. That is about $0.007 per search with page text.
  - The fast model then pulls salary figures out of the returned page text, each with a quote.
- **Checks before anything reaches the seeker:**
  - Each salary figure needs a quote that appears verbatim in the fetched page text; figures without one are dropped.
  - Every number in the reply must come from a figure that survived.
  - If nothing survives, the agent says it found no reliable figure.
- **What the seeker sees:** an indicative range for the occupation and place, labelled as a quick web lookup, with the pages linked. The pages are returned in `sources` (tool `"exa"`) and kept on the agent's `InterviewTurn`, so they appear in the export.
- **What it is not:**
  - not a claim: nothing is added to `statedSkills` or `preferences`;
  - not the market data: the sourced salary ranges come from Part 2 (`JobMarket.salaryRange`, `CareerStep.salary`);
  - never a statement about the seeker's own chances or worth.

## Part 2: Research (@cufelix)

| Method and path | Does | Body | Returns |
|---|---|---|---|
| `POST /v1/research-runs` | Start research for a profile. Returns at once; work runs in the background. Rejects a profile whose `status` is not `"complete"`. | `{ profile: SeekerProfile, options?: ResearchOptions }` | `{ runId, status: "queued" }` |
| `GET /v1/research-runs/{runId}` | Status, progress, and the result once `status` is `"done"` | | `ResearchRun` |
| `GET /v1/research-runs/{runId}/career-paths` | Up to 3 career paths (the whiteboard's "top 3"). Candidates are the seeker's target occupations plus related ESCO occupations. Selection and order come only from market demand in the seeker's locations and the seeker's stated goal, never from skill fit or evidence. The `career-paths` step runs first, and this endpoint answers as soon as that step is done, while the run is still `running`, so the client can show the paths and let the seeker pick one during the rest of the research. Each path carries its career ladder (for example junior → mid → senior → lead → CTO) with a sourced salary per step where one is found. Fields filled later in the run (`vacancyCount`, ladder salaries) may change until the run is `done`. | | `CareerPath[]` (in order) |
| `GET /v1/research-runs/{runId}/companies` | Companies researched in this run, dream companies first | | `Company[]` (paged) |
| `GET /v1/research-runs/{runId}/vacancies` | Vacancies found in this run. Filters: `?occupation=` `?companyId=` | | `Vacancy[]` (paged) |
| `GET /v1/research-runs/{runId}/market` | Job market per career path: demand per skill, vacancy counts, salary ranges | | `JobMarket[]` |
| `GET /v1/research-runs/{runId}/trends` | Then vs now per target occupation: each skill's demand about ten years ago against the last 12 months and today's vacancies, labelled rising, stable or fading, with quotes. Keeps advice built on older career paths current. | | `OccupationTrends[]` |
| `GET /v1/research-runs/{runId}/seeker-research` | User research: what the seeker's links show, plus the opt-in name search | | `SeekerResearch` |
| `DELETE /v1/research-runs/{runId}` | Cancel a running run or delete a finished one | | `{ deleted: true }` |
| `GET /v1/seekers/{seekerId}/research-runs` | All runs stored for a seeker, with results (used by Part 1's export) | | `ResearchRun[]` |
| `DELETE /v1/seekers/{seekerId}/research` | Hard delete of every run, user-research result and name-search candidate for a seeker (used by Part 1's delete) | | `{ deleted: true, runs: number }` |
| `GET /v1/companies/{companyId}` | One company with all its claims and sources (shared across runs) | | `Company` |
| `GET /v1/vacancies/{vacancyId}` | One vacancy with every sighting (when and where it was seen) | | `Vacancy & { sightings: VacancySighting[] }` |

## Part 3: Validation (@Dymyt-ry)

Stage 3 of the whiteboard. It puts the seeker's evidence next to what employers ask for in one occupation, using a finished research run.
- It scrapes nothing. Its inputs are the profile from Part 1 and the run's results from Part 2, which it reads over Part 2's HTTP API.
- Code lives in `src/gap/`. It is framework-free like Part 1 and is mounted into the one server the same way, through `src/api/part3.ts`.

| Method and path | Does | Body | Returns |
|---|---|---|---|
| `POST /v1/validations` | Build a validation for one occupation. The run must be `done` (otherwise `conflict`) and belong to `profile.seekerId` (otherwise `unprocessable`); the profile must be `complete`. The occupation is `occupationUri` if given, else `profile.careerChoice`, else the first target occupation; it must be one of the run's career paths or target occupations. Answers synchronously. | `ValidationRequest` | `Validation` |
| `GET /v1/validations/{validationId}` | One stored validation | | `Validation` |
| `GET /v1/seekers/{seekerId}/validations` | All validations stored for a seeker (used by Part 1's export) | | `Validation[]` |
| `DELETE /v1/seekers/{seekerId}/validations` | Hard delete of every validation for a seeker (used by Part 1's delete) | | `{ deleted: true, validations: number }` |

What the whiteboard's four steps become:

| Whiteboard | Validation field |
|---|---|
| Analyze the company requirements | `companies`: per company (dream companies first), each skill its ads ask for, required or nice-to-have, with the sentence from the ad |
| Analyze user match % | `skills`: per skill, how many vacancies and companies ask for it, next to the seeker's evidence: `proven` (a link the seeker owns shows it), `stated` (CV or interview only) or `none` |
| Analyze chances to get each position | `market`: facts about how open the market is, not a probability: open vacancies, how many take juniors or people without experience, how long ads stay up, reposts, salary range |
| Generalize job descriptions across markets | `jobProfile`: the typical job across the seeker's locations: which skills most, many or some ads ask for, the trend of each, the salary range and the career ladder |

**Guardrail, as in the brief:** no number that summarises the seeker against the job. That means:
- no match percentage, no "6 of 9 skills" total, no probability of being hired;
- skills are ordered by employer demand, never by the seeker's evidence;
- companies are never ranked by how well the seeker fits them.

Each fact carries its sources. A skill without evidence says `none`; it is never guessed.

**Matching skills:**
- By ESCO URI first.
- Part 1 still uses stub URIs (`urn:stub:skill:…`) until it moves to `src/shared/taxonomy/`, so the fallback is the same `slug()` of the label.

## Part 4: reserved, not designed yet

This name is taken so the first parts don't use it for something else.
- `POST /v1/roadmaps { validationId }` → `Roadmap`.

Guardrail for Parts 3 and 4: no single score, match percentage or ranking of a person. That comes from the brief.
The same holds for career paths: the ladder and its salaries describe the occupation in the seeker's locations, never the seeker's chance of reaching a step. The seeker's `careerChoice` is their pick, not ours.

## Types

Copy these into `src/contracts.ts` in both parts. The field names are the contract.

```ts
// ---------- shared ----------
type ISODate = string;            // "2026-10-08T21:00:00Z"
type Country = string;            // ISO 3166-1 alpha-2, "CZ"
type EscoUri = string;            // "http://data.europa.eu/esco/occupation/…"

type Source = {
  id: string;                     // "src_…"
  url: string;                    // web URL, or seeker-upload://… / seeker-interview://… (see Conventions)
  title: string;
  fetchedAt: ISODate;
  tool: "apify" | "firecrawl" | "exa" | "registry" | "seeker-upload" | "seeker-link" | "seeker-interview";
  quote?: string;                 // must appear verbatim in the stored snapshot
  contentHash: string;
  snapshotKey?: string;           // raw copy in object storage
};

type Claim = {
  id: string;                     // "clm_…"
  subject: { kind: "company" | "vacancy" | "seeker"; id: string };
  statement: string;              // "Requires Docker", "Has a public project using Docker"
  skill?: Skill;                  // set on every skill claim, so parts compare ESCO URIs, never prose
  kind: "fact" | "inference";
  tier: "verified" | "corroborated" | "single-source" | "contradicted" | "stated";
                                  // "stated" = said by the seeker only, never counts as proof
  sources: Source[];              // a claim without sources is never returned
  validUntil?: ISODate;
};

type Occupation = { uri: EscoUri; label: string; lang: string };
type Skill = { uri: EscoUri; label: string; lang: string };

// ---------- Part 1: user input ----------
type Consent = {
  dataProcessing: true;           // required
  nameSearch: boolean;            // opt-in for the light web search on the seeker's name
  givenAt: ISODate;
  policyVersion: string;
};

type CareerPreferences = {
  targetOccupations: Occupation[];          // at least 1 for a complete profile
  locations: { country: Country; city?: string }[];
  remote: "only" | "ok" | "no";
  goal: "learn-fast" | "stability" | "mission";
  dreamCompanies: { name: string; url?: string }[];
  dealBreakers: string[];                   // free text from the interview
  languages: { lang: string; level: "basic" | "working" | "fluent" | "native" }[];
  salaryExpectation?: { min: number; currency: string; period: "month" | "year" };
};

type CareerPreferencesDraft = Partial<CareerPreferences>;   // what the interview has filled in so far

type InterviewTurn = {
  role: "agent" | "seeker";
  text: string;
  at: ISODate;
  sources?: Source[];             // agent turns only: the pages behind a salary lookup, tool "exa"
};

type SeekerDocument = {
  id: string;                     // "doc_…"
  kind: "cv";
  fileName: string;
  uploadedAt: ISODate;
  statedSkills: Claim[];          // tier "stated", source tool "seeker-upload"
  experience: { title: string; organisation?: string; from?: string; to?: string }[];
  education: { title: string; institution?: string; from?: string; to?: string }[];
};

type SeekerLinkInput = { url: string; kind: "portfolio" | "github" | "linkedin" | "social" | "certificate" | "publication" | "other" };
type SeekerLink = SeekerLinkInput & { id: string; addedAt: ISODate };   // "lnk_…"

type SeekerProfile = {
  seekerId: string;               // "skr_…"
  profileVersion: number;         // +1 on every change; research results say which version they used
  status: "incomplete" | "complete";
  consent: Consent;
  preferences: CareerPreferences;
  statedSkills: Claim[];          // merged from CV and interview, tier "stated"
  documents: SeekerDocument[];
  links: SeekerLink[];
  careerChoice?: CareerChoice;    // set once the seeker picks one of a run's career paths
  updatedAt: ISODate;
};

type CareerChoice = {
  occupation: Occupation;         // one of the run's CareerPath.occupation
  runId: string;                  // the run whose career paths were shown
  chosenAt: ISODate;
};

type SeekerExport = { profile: SeekerProfile; interview: InterviewTurn[]; researchRuns: ResearchRun[]; validations: Validation[] };

// ---------- Part 2: research ----------
type ResearchOptions = {
  maxCompanies?: number;          // default 50
  maxVacancies?: number;          // default 500
  sources?: ("apify" | "firecrawl" | "exa" | "registry")[];   // default all
  nameSearch?: boolean;           // default false. Runs only when this is true AND profile.consent.nameSearch is true
};

type ResearchRun = {
  runId: string;                  // "run_…"
  seekerId: string;
  profileVersion: number;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  progress: { step: "career-paths" | "companies" | "vacancies" | "market" | "seeker-research"; done: number; total: number }[];
  startedAt?: ISODate;
  finishedAt?: ISODate;
  error?: { code: string; message: string };
  result?: ResearchResult;        // present when status is "done"
  cost: { tool: string; units: number; usd: number }[];
};

type ResearchResult = {
  careerPaths: CareerPath[];
  trends: OccupationTrends[];
  companyIds: string[];
  vacancyIds: string[];
  market: JobMarket[];
  seekerResearch: SeekerResearch;
};

type CareerPath = {
  occupation: Occupation;
  why: Claim[];                   // sourced reasons, e.g. demand in the seeker's locations
  vacancyCount: number;           // in the seeker's locations
  ladder?: CareerStep[];          // ordered from entry to the top; absent until the run has found it
  // no fit score: order comes from market demand and the seeker's goal, never from how "good" the seeker is
};

type CareerStep = {
  level: "entry" | "junior" | "mid" | "senior" | "lead" | "executive";
  title: string;                  // "Junior backend developer", "Chief technology officer"
  occupation?: Occupation;        // only when the step is its own ESCO occupation (e.g. chief technology officer)
  typicalExperienceYears?: { min: number; max?: number };   // from the ads' requirements, e.g. "5+ years"
  salary?: {                      // omitted when no source gives one; never estimated without a source
    p25?: number; median: number; p75?: number;
    currency: string; period: "month" | "year";
    sampleSize: number;
    location: { country: Country; city?: string };
  };
  claims: Claim[];                // sources for the step, its experience and its salary (job ads, salary sites);
                                  // a ladder shape drawn from those ads is kind "inference"
};

type Company = {
  id: string;                     // "cmp_…"
  name: string;
  domain?: string;
  country: Country;
  registryIds: { scheme: string; id: string }[];   // "lei", "cz-ico", "uk-companies-house"…
  isDreamCompany: boolean;        // true when it came from the seeker's preferences
  claims: Claim[];                // registry facts, stated values, reviews, headcount
  ghostSignals: Claim[];          // always kind "inference"
};

type Vacancy = {
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

type VacancySighting = { seenAt: ISODate; url: string; contentHash: string; source: "apify" | "firecrawl" | "exa" };

type JobMarket = {
  occupation: Occupation;
  location: { country: Country; city?: string };
  vacancyCount: number;
  skillDemand: { skill: Skill; vacanciesRequiring: number; vacanciesTotal: number; sources: Source[] }[];
  salaryRange?: { p25: number; median: number; p75: number; currency: string; period: "month" | "year"; sampleSize: number };
};

type OccupationTrends = {
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

type SeekerResearch = {
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

// ---------- Part 3: validation ----------
type Evidence = "proven" | "stated" | "none";
                                  // proven: a provenSkills claim from a seeker link with ownership "confirmed"
                                  // stated: only in the CV or the interview (tier "stated"); none: nothing found

type ValidationRequest = {
  profile: SeekerProfile;
  runId: string;
  occupationUri?: EscoUri;        // default: profile.careerChoice, else the first target occupation
};

type Validation = {
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

type SalaryRange = { p25: number; median: number; p75: number; currency: string; period: "month" | "year"; sampleSize: number };

type JobProfile = {               // the typical job across the seeker's locations
  occupation: Occupation;
  vacanciesAnalysed: number;
  markets: { country: Country; city?: string; vacancies: number }[];
  skills: {
    skill: Skill;
    vacanciesRequiring: number;
    vacanciesTotal: number;
    band: "most" | "many" | "some";   // most: at least half of the ads, many: 20-49 %, some: under 20 %
    trend?: "rising" | "stable" | "fading";
    sources: Source[];            // quotes from the ads
  }[];
  salaryRange?: SalaryRange;
  ladder?: CareerStep[];
  summary?: Claim;                // kind "inference": a plain description drawn from the ads, the ads as sources
};

type SkillCheck = {
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
};

type CompanyCheck = {
  companyId: string;
  name: string;
  isDreamCompany: boolean;
  vacancyIds: string[];
  requirements: { skill: Skill; required: boolean; evidence: Evidence; source: Source }[];   // quote = the sentence in the ad
};

type MarketFacts = {              // how open the market is; never a probability for the seeker
  location: { country: Country; city?: string };
  openVacancies: number;
  entryLevelVacancies: number;    // ads for juniors, trainees or people without experience (title or requirement quote)
  entryLevelSources: Source[];
  medianDaysOpen?: number;        // from firstSeenAt to lastSeenAt
  repostedVacancies: number;      // repostCount of at least 1
  salaryRange?: SalaryRange;
};
```

## Testing the seam

- Part 1 keeps example profiles in `fixtures/profiles/*.json`, each valid against `SeekerProfile`.
- Part 2's tests post those exact files to `POST /v1/research-runs`.
- If either side changes a type without updating this file, those tests break.
