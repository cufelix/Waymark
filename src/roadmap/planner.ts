import { ApiError } from "../seeker/core/errors.ts";
import { newId } from "../seeker/core/ids.ts";
import type { LlmClient } from "../seeker/llm/llm.ts";
import { MODELS, unfence } from "../seeker/llm/llm.ts";
import type { Evidence, RoadmapChapter, RoadmapModule, SeekerProfile, Validation } from "./contracts.ts";

export type PlannerDeps = { llm: LlmClient };

const CATEGORIES = new Set<RoadmapChapter["category"]>(["code", "data", "theory", "tools", "project", "soft"]);
const EVIDENCE_RANK: Record<Evidence, number> = { none: 0, stated: 1, proven: 2 };
const NUMBER = /\d+/gu;

type ModelChapter = {
  title: string;
  category: RoadmapChapter["category"];
  skillUris: string[];
  outcome: string;
  estimatedHours?: number;
};

type ModelModule = {
  title: string;
  subtitle: string;
  why: string;
  chapters: ModelChapter[];
};

type CatalogSkill = {
  skill: Validation["skills"][number]["skill"];
  band: Validation["jobProfile"]["skills"][number]["band"];
  demand: NonNullable<RoadmapChapter["demand"]>;
  evidence: Evidence;
  claims: RoadmapChapter["claims"];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key))
    && keys.every((key) => required.includes(key) || optional.includes(key));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parsePlan(raw: string): ModelModule[] {
  let value: unknown;
  try {
    value = JSON.parse(unfence(raw));
  } catch {
    throw new ApiError("upstream_failed", "Roadmap planner returned invalid JSON");
  }
  if (!isObject(value) || !hasExactKeys(value, ["modules"]) || !Array.isArray(value.modules) || value.modules.length === 0) {
    throw new ApiError("upstream_failed", "Roadmap planner returned invalid modules");
  }

  const modules: ModelModule[] = [];
  for (const module of value.modules) {
    if (
      !isObject(module) || !hasExactKeys(module, ["title", "subtitle", "why", "chapters"]) ||
      !nonEmptyString(module.title) || !nonEmptyString(module.subtitle) || !nonEmptyString(module.why) ||
      !Array.isArray(module.chapters) || module.chapters.length === 0
    ) throw new ApiError("upstream_failed", "Roadmap planner returned invalid modules");

    const chapters: ModelChapter[] = [];
    for (const chapter of module.chapters) {
      if (
        !isObject(chapter) ||
        !hasExactKeys(chapter, ["title", "category", "skillUris", "outcome"], ["estimatedHours"]) ||
        !nonEmptyString(chapter.title) || !CATEGORIES.has(chapter.category as RoadmapChapter["category"]) ||
        !Array.isArray(chapter.skillUris) || !chapter.skillUris.every(nonEmptyString) ||
        !nonEmptyString(chapter.outcome) ||
        (chapter.estimatedHours !== undefined &&
          (typeof chapter.estimatedHours !== "number" || !Number.isFinite(chapter.estimatedHours) || chapter.estimatedHours <= 0))
      ) throw new ApiError("upstream_failed", "Roadmap planner returned invalid chapters");
      chapters.push({
        title: chapter.title.trim(),
        category: chapter.category as RoadmapChapter["category"],
        skillUris: [...new Set((chapter.skillUris as string[]).map((uri) => uri.trim()))],
        outcome: chapter.outcome.trim(),
        ...(chapter.estimatedHours === undefined ? {} : { estimatedHours: chapter.estimatedHours }),
      });
    }
    modules.push({
      title: module.title.trim(),
      subtitle: module.subtitle.trim(),
      why: module.why.trim(),
      chapters,
    });
  }
  return modules;
}

function skillCatalog(validation: Validation): Map<string, CatalogSkill> {
  const checks = new Map(validation.skills.map((check) => [check.skill.uri, check]));
  const catalog = new Map<string, CatalogSkill>();
  for (const profileSkill of validation.jobProfile.skills) {
    const check = checks.get(profileSkill.skill.uri);
    catalog.set(profileSkill.skill.uri, {
      skill: check?.skill ?? profileSkill.skill,
      band: profileSkill.band,
      demand: check === undefined
        ? {
          vacanciesRequiring: profileSkill.vacanciesRequiring,
          vacanciesTotal: profileSkill.vacanciesTotal,
          sources: [...profileSkill.sources],
        }
        : {
          vacanciesRequiring: check.demand.vacanciesRequiring,
          vacanciesTotal: check.demand.vacanciesTotal,
          sources: [...check.demand.sources],
        },
      evidence: check?.evidence ?? "none",
      claims: check === undefined ? [] : [...check.claims],
    });
  }
  for (const check of validation.skills) {
    if (catalog.has(check.skill.uri)) continue;
    catalog.set(check.skill.uri, {
      skill: check.skill,
      band: "some",
      demand: {
        vacanciesRequiring: check.demand.vacanciesRequiring,
        vacanciesTotal: check.demand.vacanciesTotal,
        sources: [...check.demand.sources],
      },
      evidence: check.evidence,
      claims: [...check.claims],
    });
  }
  return catalog;
}

function weakestEvidence(skills: CatalogSkill[]): Evidence {
  return skills.reduce<Evidence>(
    (weakest, skill) => EVIDENCE_RANK[skill.evidence] < EVIDENCE_RANK[weakest] ? skill.evidence : weakest,
    "proven",
  );
}

function completion(skills: CatalogSkill[]): Pick<RoadmapChapter, "done" | "doneBy"> | { done: false } {
  if (skills.length > 0 && skills.every(({ evidence }) => evidence === "stated" || evidence === "proven")) {
    return { done: true, doneBy: "evidence" };
  }
  return { done: false };
}

function materializeChapter(chapter: ModelChapter, catalog: Map<string, CatalogSkill>): RoadmapChapter {
  const matched = chapter.skillUris
    .map((uri) => catalog.get(uri))
    .filter((skill): skill is CatalogSkill => skill !== undefined);
  const claims = [...new Map(matched.flatMap((skill) => skill.claims).map((claim) => [claim.id, claim])).values()];
  return {
    chapterId: newId("chp"),
    title: chapter.title,
    category: chapter.category,
    skills: matched.map(({ skill }) => skill),
    ...(matched[0] === undefined ? {} : { demand: matched[0].demand }),
    evidence: matched.length === 0 ? "none" : weakestEvidence(matched),
    claims,
    outcome: chapter.outcome,
    ...(chapter.estimatedHours === undefined ? {} : { estimatedHours: chapter.estimatedHours }),
    resources: [],
    ...completion(matched),
  };
}

function fallbackChapter(skill: CatalogSkill): RoadmapChapter {
  return {
    chapterId: newId("chp"),
    title: `${skill.skill.label} practice`,
    category: "project",
    skills: [skill.skill],
    demand: skill.demand,
    evidence: skill.evidence,
    claims: [...skill.claims],
    outcome: "Use the employer-requested skill in a practical task.",
    resources: [],
    ...completion([skill]),
  };
}

function materializePlan(plan: ModelModule[], catalog: Map<string, CatalogSkill>): RoadmapModule[] {
  const modules = plan.map((module) => ({
    moduleId: newId("mod"),
    title: module.title,
    subtitle: module.subtitle,
    why: module.why,
    chapters: module.chapters.map((chapter) => materializeChapter(chapter, catalog)),
  }));
  const placedUris = new Set(modules.flatMap((module) => module.chapters.flatMap((chapter) => chapter.skills.map(({ uri }) => uri))));
  const missing = [...catalog.values()].filter(({ skill, band }) =>
    (band === "most" || band === "many") && !placedUris.has(skill.uri)
  );
  modules.at(-1)!.chapters.push(...missing.map(fallbackChapter));
  return modules;
}

function allowedNumbers(chapters: RoadmapChapter[]): Set<string> {
  return new Set(chapters.flatMap(({ demand }) => demand === undefined
    ? []
    : [String(demand.vacanciesRequiring), String(demand.vacanciesTotal)]));
}

function hasUnsupportedNumber(text: string, allowed: Set<string>): boolean {
  return (text.match(NUMBER) ?? []).some((number) => !allowed.has(number));
}

function planHasUnsupportedNumbers(modules: RoadmapModule[]): boolean {
  return modules.some((module) => {
    const moduleNumbers = allowedNumbers(module.chapters);
    return hasUnsupportedNumber(module.title, moduleNumbers) || hasUnsupportedNumber(module.subtitle, moduleNumbers) ||
      hasUnsupportedNumber(module.why, moduleNumbers) || module.chapters.some((chapter) => {
        const chapterNumbers = allowedNumbers([chapter]);
        return hasUnsupportedNumber(chapter.title, chapterNumbers) || hasUnsupportedNumber(chapter.outcome, chapterNumbers);
      });
  });
}

function removeUnsupportedSentences(text: string, allowed: Set<string>, fallback: string): string {
  const sentences = text.match(/[^.!?\n]+[.!?]?/gu) ?? [];
  const kept = sentences.filter((sentence) => !hasUnsupportedNumber(sentence, allowed)).join(" ").trim();
  return kept || fallback;
}

function sanitizeNumbers(modules: RoadmapModule[]): RoadmapModule[] {
  return modules.map((module) => {
    const moduleNumbers = allowedNumbers(module.chapters);
    return {
      ...module,
      title: removeUnsupportedSentences(module.title, moduleNumbers, "Learning module"),
      subtitle: removeUnsupportedSentences(module.subtitle, moduleNumbers, "Skill foundations"),
      why: removeUnsupportedSentences(module.why, moduleNumbers, "Build the prerequisites for practical work."),
      chapters: module.chapters.map((chapter) => {
        const chapterNumbers = allowedNumbers([chapter]);
        return {
          ...chapter,
          title: removeUnsupportedSentences(chapter.title, chapterNumbers, "Employer-requested skill"),
          outcome: removeUnsupportedSentences(chapter.outcome, chapterNumbers, "Practice the skill in a practical task."),
        };
      }),
    };
  });
}

function prompts(validation: Validation, profile: SeekerProfile) {
  const skills = [...skillCatalog(validation).values()].map((entry) => ({
    label: entry.skill.label,
    uri: entry.skill.uri,
    band: entry.band,
    demand: {
      vacanciesRequiring: entry.demand.vacanciesRequiring,
      vacanciesTotal: entry.demand.vacanciesTotal,
    },
    evidence: entry.evidence,
  }));
  return [
    {
      role: "system" as const,
      content:
        'Plan a learning roadmap in prerequisite order. Return only strict JSON: {"modules":[{"title":"string","subtitle":"string","why":"string","chapters":[{"title":"string","category":"code|data|theory|tools|project|soft","skillUris":["exact supplied URI"],"outcome":"string","estimatedHours":number?}]}]}. Use no other keys. Unknown skill URIs are forbidden. A foundation chapter may use an empty skillUris array. Do not write scores, percentages, progress, XP, numeric levels, rankings, or hiring probabilities. Do not put a digit in title, subtitle, why, or outcome unless it exactly copies a supplied vacanciesRequiring or vacanciesTotal fact. For learn-fast, use fewer shorter chapters and place projects early. For stability, put the most-demanded skills first within prerequisite constraints. For mission, keep the natural prerequisite order.',
    },
    {
      role: "user" as const,
      content: JSON.stringify({
        occupation: validation.occupation,
        skills,
        goal: profile.preferences.goal,
        languages: profile.preferences.languages,
      }),
    },
  ];
}

async function callPlanner(
  deps: PlannerDeps,
  messages: ReturnType<typeof prompts>,
  correction?: { previous: string; instruction: string },
): Promise<string> {
  try {
    return await deps.llm.chat({
      model: MODELS.fast,
      json: true,
      temperature: 0,
      messages: correction === undefined
        ? messages
        : [...messages, { role: "assistant", content: correction.previous }, { role: "user", content: correction.instruction }],
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("upstream_failed", "Roadmap planner request failed");
  }
}

/** Plans prerequisite-ordered modules and empty-resource chapters using only facts copied from the validation. */
export async function planModules(
  validation: Validation,
  profile: SeekerProfile,
  deps: PlannerDeps,
): Promise<RoadmapModule[]> {
  const messages = prompts(validation, profile);
  const catalog = skillCatalog(validation);
  let firstRaw = await callPlanner(deps, messages);
  let firstPlan: ModelModule[] | undefined;
  try {
    firstPlan = parsePlan(firstRaw);
  } catch {
    firstRaw = await callPlanner(
      deps,
      messages,
      {
        previous: firstRaw,
        instruction: "Your previous reply did not match the required JSON shape. Retry once with only the exact schema and allowed values.",
      },
    );
    return sanitizeNumbers(materializePlan(parsePlan(firstRaw), catalog));
  }

  const firstModules = materializePlan(firstPlan, catalog);
  if (!planHasUnsupportedNumbers(firstModules)) return firstModules;

  const secondRaw = await callPlanner(
    deps,
    messages,
    {
      previous: firstRaw,
      instruction: "Your previous reply introduced a digit that was not copied from the supplied vacancy demand facts. Retry once. Remove unsupported numbers and return only the exact JSON schema.",
    },
  );
  const secondModules = materializePlan(parsePlan(secondRaw), catalog);
  return planHasUnsupportedNumbers(secondModules) ? sanitizeNumbers(secondModules) : secondModules;
}
