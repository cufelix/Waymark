// Types for Part 4 (Stage 4: roadmap), copied from API.md. The field names are the contract.
// Shared, Part 1 and Part 3 types come from src/gap/contracts.ts.
import type {
  CareerStep,
  Claim,
  Evidence,
  ISODate,
  Occupation,
  SeekerProfile,
  Skill,
  Source,
  Validation,
} from "../gap/contracts.ts";

export type { CareerStep, Claim, Evidence, ISODate, Occupation, SeekerProfile, Skill, Source, Validation };

export type RoadmapRequest = {
  validationId: string;
  profile: SeekerProfile;         // for goal, languages and the latest claims
};

export type Roadmap = {
  roadmapId: string;              // "rmp_…"
  seekerId: string;
  validationId: string;
  runId: string;
  occupation: Occupation;
  goal: "learn-fast" | "stability" | "mission";
  status: "building" | "ready" | "failed";
  error?: { code: string; message: string };      // only when failed, as on ResearchRun
  target?: RoadmapTarget;         // set once ready, when the ladder has a step the market hires into
  modules: RoadmapModule[];       // prerequisite order; empty while building
  createdAt: ISODate;
  updatedAt: ISODate;
};

export type RoadmapTarget = {
  step: CareerStep;               // from the validation's jobProfile.ladder
  facts: Claim[];                 // e.g. entry-level ad facts, with sources; never a probability
};

export type RoadmapModule = {
  moduleId: string;               // "mod_…"
  title: string;                  // "Python + Mathematics"
  subtitle: string;               // "Core foundations"
  why: string;                    // why it comes at this point; numbers only from its chapters' demand
  chapters: RoadmapChapter[];
};

export type RoadmapChapter = {
  chapterId: string;              // "chp_…"
  title: string;                  // "Variables and logic"
  category: "code" | "data" | "theory" | "tools" | "project" | "soft";
  skills: Skill[];                // the ESCO skills it teaches; empty for a foundation no ad names
  demand?: {                      // copied from the validation's SkillCheck, never computed by the model
    vacanciesRequiring: number;
    vacanciesTotal: number;
    sources: Source[];
  };
  evidence: Evidence;             // copied from the validation
  claims: Claim[];
  outcome: string;
  estimatedHours?: number;        // the planner's estimate, shown as "about"
  resources: LearningResource[];  // free first
  topPickId?: string;
  done: boolean;                  // the seeker's own tick, never proof
  doneAt?: ISODate;
};

export type LearningResource = {
  resourceId: string;             // "res_…"
  title: string;
  provider: string;
  url: string;
  format: "course" | "video" | "book" | "practice" | "docs" | "article";
  cost: "free" | "freemium" | "paid";
  price?: string;                 // only when the page states it
  level?: "beginner" | "intermediate" | "advanced";
  lang: string;
  scope?: string;                 // only when the page states it
  effortHours?: number;           // only when the page states it
  source: Source;                 // page found through Exa; quote appears verbatim on the page
};

export type RoadmapProgress = { done: boolean };
