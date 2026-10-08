import type { ExaResult } from "../../seeker/salary/exa.ts";
import type { Claim, Occupation, SeekerProfile, Skill, Source, Validation } from "../contracts.ts";

const AT = "2026-10-09T09:00:00Z";
const SEEKER_ID = "skr_00000000000000000000000001";
const DOCUMENT_ID = "doc_00000000000000000000000001";

export const OCCUPATION: Occupation = {
  uri: "urn:stub:occupation:backend-developer",
  label: "backend developer",
  lang: "en",
};

export const PYTHON: Skill = { uri: "urn:stub:skill:python", label: "Python", lang: "en" };
export const SQL: Skill = { uri: "urn:stub:skill:sql", label: "SQL", lang: "en" };
export const DOCKER: Skill = { uri: "urn:stub:skill:docker", label: "Docker", lang: "en" };
export const GIT: Skill = { uri: "urn:stub:skill:git", label: "Git", lang: "en" };

const source = (id: string, url: string, title: string, quote: string, tool: Source["tool"] = "exa"): Source => ({
  id,
  url,
  title,
  fetchedAt: AT,
  tool,
  quote,
  contentHash: id.slice(-1).repeat(64),
});

const PYTHON_AD = source(
  "src_00000000000000000000000001",
  "https://example.com/jobs/python-backend",
  "Example Python backend vacancy",
  "Python is required for this backend developer role.",
);
const SQL_AD = source(
  "src_00000000000000000000000002",
  "https://example.com/jobs/sql-backend",
  "Example SQL backend vacancy",
  "You will write SQL queries for production services.",
);
const DOCKER_AD = source(
  "src_00000000000000000000000003",
  "https://example.com/jobs/docker-backend",
  "Example Docker backend vacancy",
  "Experience with Docker is welcome.",
);
const GIT_AD = source(
  "src_00000000000000000000000004",
  "https://example.com/jobs/git-backend",
  "Example Git backend vacancy",
  "The team uses Git for version control.",
);
const ENTRY_AD = source(
  "src_00000000000000000000000005",
  "https://example.com/jobs/junior-backend",
  "Example junior backend vacancy",
  "Junior backend developers are welcome and no prior work experience is required.",
);
const SALARY_PAGE = source(
  "src_00000000000000000000000006",
  "https://example.com/salaries/backend-prague",
  "Example Prague backend salaries",
  "Junior backend developer salaries in this sample have a median of 55000 CZK per month.",
);
const GIT_LINK = source(
  "src_00000000000000000000000007",
  "https://example.com/jane-example/git-project",
  "Jane Example's fake Git project",
  "This repository uses Git branches and pull requests.",
  "seeker-link",
);
const CV_SOURCE = source(
  "src_00000000000000000000000008",
  `seeker-upload://${DOCUMENT_ID}`,
  "CV: jane-example.pdf",
  "Used SQL in a school database project.",
  "seeker-upload",
);
const MID_AD = source(
  "src_00000000000000000000000009",
  "https://example.com/jobs/mid-backend",
  "Example mid-level backend vacancy",
  "This mid-level backend developer role asks for three years of experience.",
);

const statedSql: Claim = {
  id: "clm_00000000000000000000000001",
  subject: { kind: "seeker", id: SEEKER_ID },
  statement: "States skill: SQL",
  skill: SQL,
  kind: "fact",
  tier: "stated",
  sources: [CV_SOURCE],
};

const provenGit: Claim = {
  id: "clm_00000000000000000000000002",
  subject: { kind: "seeker", id: SEEKER_ID },
  statement: "Has a public project using Git",
  skill: GIT,
  kind: "fact",
  tier: "single-source",
  sources: [GIT_LINK],
};

const entryClaim: Claim = {
  id: "clm_00000000000000000000000003",
  subject: { kind: "vacancy", id: "vac_00000000000000000000000001" },
  statement: "Prague employers advertise junior backend developer roles without prior work experience.",
  kind: "fact",
  tier: "single-source",
  sources: [ENTRY_AD],
};

const entrySalaryClaim: Claim = {
  id: "clm_00000000000000000000000004",
  subject: { kind: "vacancy", id: "vac_00000000000000000000000001" },
  statement: "The sampled junior backend salary median is 55000 CZK per month.",
  kind: "fact",
  tier: "single-source",
  sources: [SALARY_PAGE],
};

const midClaim: Claim = {
  id: "clm_00000000000000000000000005",
  subject: { kind: "vacancy", id: "vac_00000000000000000000000002" },
  statement: "A mid-level backend vacancy asks for three years of experience.",
  kind: "fact",
  tier: "single-source",
  sources: [MID_AD],
};

export const PROFILE: SeekerProfile = {
  seekerId: SEEKER_ID,
  profileVersion: 3,
  status: "complete",
  consent: {
    dataProcessing: true,
    nameSearch: false,
    givenAt: "2026-10-08T12:00:00Z",
    policyVersion: "test-v1",
  },
  preferences: {
    targetOccupations: [OCCUPATION],
    locations: [{ country: "CZ", city: "Prague" }],
    remote: "ok",
    goal: "learn-fast",
    dreamCompanies: [],
    dealBreakers: [],
    languages: [
      { lang: "en", level: "fluent" },
      { lang: "cs", level: "native" },
    ],
  },
  statedSkills: [statedSql],
  documents: [{
    id: DOCUMENT_ID,
    kind: "cv",
    fileName: "jane-example.pdf",
    uploadedAt: "2026-10-08T12:10:00Z",
    statedSkills: [statedSql],
    experience: [],
    education: [{ title: "Example Computer Science Course", institution: "Example School" }],
  }],
  links: [],
  careerChoice: {
    occupation: OCCUPATION,
    runId: "run_00000000000000000000000001",
    chosenAt: "2026-10-08T14:00:00Z",
  },
  updatedAt: AT,
};

export const VALIDATION: Validation = {
  validationId: "val_00000000000000000000000001",
  seekerId: SEEKER_ID,
  runId: "run_00000000000000000000000001",
  profileVersion: PROFILE.profileVersion,
  createdAt: AT,
  occupation: OCCUPATION,
  locations: [{ country: "CZ", city: "Prague" }],
  jobProfile: {
    occupation: OCCUPATION,
    vacanciesAnalysed: 120,
    markets: [{ country: "CZ", city: "Prague", vacancies: 120 }],
    skills: [
      { skill: PYTHON, vacanciesRequiring: 72, vacanciesTotal: 120, band: "most", sources: [PYTHON_AD] },
      { skill: SQL, vacanciesRequiring: 48, vacanciesTotal: 120, band: "many", sources: [SQL_AD] },
      { skill: DOCKER, vacanciesRequiring: 18, vacanciesTotal: 120, band: "some", sources: [DOCKER_AD] },
      { skill: GIT, vacanciesRequiring: 12, vacanciesTotal: 120, band: "some", sources: [GIT_AD] },
    ],
    salaryRange: { p25: 48000, median: 62000, p75: 78000, currency: "CZK", period: "month", sampleSize: 24 },
    ladder: [
      {
        level: "junior",
        title: "Junior backend developer",
        typicalExperienceYears: { min: 0, max: 1 },
        salary: {
          p25: 45000,
          median: 55000,
          p75: 65000,
          currency: "CZK",
          period: "month",
          sampleSize: 12,
          location: { country: "CZ", city: "Prague" },
        },
        claims: [entryClaim, entrySalaryClaim],
      },
      {
        level: "mid",
        title: "Backend developer",
        typicalExperienceYears: { min: 3 },
        salary: {
          p25: 65000,
          median: 78000,
          p75: 92000,
          currency: "CZK",
          period: "month",
          sampleSize: 12,
          location: { country: "CZ", city: "Prague" },
        },
        claims: [midClaim],
      },
    ],
  },
  skills: [
    {
      skill: PYTHON,
      demand: { vacanciesRequiring: 72, vacanciesTotal: 120, companiesRequiring: 18, companiesTotal: 25, requiredIn: 60, sources: [PYTHON_AD] },
      evidence: "none",
      claims: [],
    },
    {
      skill: SQL,
      demand: { vacanciesRequiring: 48, vacanciesTotal: 120, companiesRequiring: 13, companiesTotal: 25, requiredIn: 35, sources: [SQL_AD] },
      evidence: "stated",
      claims: [statedSql],
    },
    {
      skill: DOCKER,
      demand: { vacanciesRequiring: 18, vacanciesTotal: 120, companiesRequiring: 7, companiesTotal: 25, requiredIn: 8, sources: [DOCKER_AD] },
      evidence: "none",
      claims: [],
    },
    {
      skill: GIT,
      demand: { vacanciesRequiring: 12, vacanciesTotal: 120, companiesRequiring: 6, companiesTotal: 25, requiredIn: 4, sources: [GIT_AD] },
      evidence: "proven",
      claims: [provenGit],
    },
  ],
  companies: [],
  market: [{
    location: { country: "CZ", city: "Prague" },
    openVacancies: 120,
    entryLevelVacancies: 14,
    entryLevelSources: [ENTRY_AD],
    medianDaysOpen: 21,
    repostedVacancies: 9,
    salaryRange: { p25: 48000, median: 62000, p75: 78000, currency: "CZK", period: "month", sampleSize: 24 },
  }],
};

export const EXA_PAGES: ExaResult[] = [
  {
    url: "https://example.com/learn/python-basics",
    title: "Example Python Basics Course",
    text: "This beginner Python basics course is free. It teaches variables, conditions, loops, and functions through short exercises.",
  },
  {
    url: "https://example.com/books/practical-python",
    title: "Practical Python, Example Edition",
    text: "This beginner book costs EUR 24. The variables and logic chapter introduces Python expressions and control flow.",
  },
  {
    url: "https://example.com/practice/python-starter",
    title: "Example Python Starter Practice",
    text: "Practice Python variables and logic in an interactive browser workspace. Starter exercises are available in English.",
  },
];
