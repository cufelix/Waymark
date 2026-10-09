import { ApiError } from "../seeker/core/errors.ts";
import { newId } from "../seeker/core/ids.ts";
import type { LlmClient } from "../seeker/llm/llm.ts";
import { MODELS, unfence } from "../seeker/llm/llm.ts";
import type { Evidence, RoadmapChapter, RoadmapModule, SeekerProfile, Validation } from "./contracts.ts";

export type PlannerDeps = { llm: LlmClient };

const CATEGORIES = new Set<RoadmapChapter["category"]>(["code", "data", "theory", "tools", "project", "soft"]);
const CHAPTER_LIMIT: Record<SeekerProfile["preferences"]["goal"], number> = {
  "learn-fast": 8,
  stability: 14,
  mission: 14,
};
const EVIDENCE_RANK: Record<Evidence, number> = { none: 0, stated: 1, proven: 2 };
const NUMBER = /\d+/gu;
const FORBIDDEN_SEEKER_SUMMARY = /%|\bxp\b|\blevel\s+\d+\b|\b\d+\s+of\s+\d+\s+(?:chapters?|modules?)\b|\b(?:scores?|percent(?:age)?s?|probabilit(?:y|ies))\b|\bfit\s+scores?\b|\bskills?\s+match(?:es|ing)?\b|\bmatch\s+(?:scores?|percent(?:age)?s?|probabilit(?:y|ies))\b/iu;
// "Chance" or "likely" is fine in prose ("a chance to practise"); only next to getting hired is it a forbidden prediction.
const ODDS_WORD = /\b(?:probability|probable|chances?|likely|likelihood|odds)\b|šanc|pravděpodob/iu;
const HIRING_WORD = /\b(?:hire[ds]?|hiring|job|position|role|offer|employ\w*|land(?:ing)?)\b|přijet|přijm|pozic|zaměstn/iu;

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

function materializePlan(plan: ModelModule[], catalog: Map<string, CatalogSkill>, limit: number): RoadmapModule[] {
  const modules = plan.map((module) => ({
    moduleId: newId("mod"),
    title: module.title,
    subtitle: module.subtitle,
    why: module.why,
    chapters: module.chapters.map((chapter) => materializeChapter(chapter, catalog)),
  }));
  const mostUris = new Set([...catalog.values()].filter(({ band }) => band === "most").map(({ skill }) => skill.uri));
  const positions = modules.flatMap((module, moduleIndex) => module.chapters.map((chapter, chapterIndex) => ({
    moduleIndex,
    chapterIndex,
    chapter,
  })));
  const essential = positions.filter(({ chapter }) => chapter.skills.some(({ uri }) => mostUris.has(uri)));
  const plannedMostUris = new Set(essential.flatMap(({ chapter }) => chapter.skills.map(({ uri }) => uri)));
  const missing = [...catalog.values()].filter(({ skill, band }) => band === "most" && !plannedMostUris.has(skill.uri));
  const plannedLimit = Math.max(0, limit - Math.min(limit, missing.length));
  const selected = new Set(essential.slice(0, plannedLimit));
  for (const position of positions) {
    if (selected.size >= plannedLimit) break;
    selected.add(position);
  }
  const kept = modules.flatMap((module, moduleIndex) => {
    const chapters = positions
      .filter((position) => position.moduleIndex === moduleIndex && selected.has(position))
      .sort((left, right) => left.chapterIndex - right.chapterIndex)
      .map(({ chapter }) => chapter);
    return chapters.length === 0 ? [] : [{ ...module, chapters }];
  });
  const fallbackSlots = limit - selected.size;
  if (fallbackSlots > 0 && missing.length > 0) {
    const destination = kept.at(-1) ?? { ...modules[0]!, chapters: [] };
    if (kept.length === 0) kept.push(destination);
    destination.chapters.push(...missing.slice(0, fallbackSlots).map(fallbackChapter));
  }
  return kept;
}

function allowedNumbers(chapters: RoadmapChapter[]): Set<string> {
  return new Set(chapters.flatMap(({ demand }) => demand === undefined
    ? []
    : [String(demand.vacanciesRequiring), String(demand.vacanciesTotal)]));
}

function hasUnsupportedNumber(text: string, allowed: Set<string>): boolean {
  return (text.match(NUMBER) ?? []).some((number) => !allowed.has(number));
}

function hasForbiddenSummary(text: string): boolean {
  return FORBIDDEN_SEEKER_SUMMARY.test(text) || (ODDS_WORD.test(text) && HIRING_WORD.test(text));
}

function hasUnsupportedText(text: string, allowed: Set<string>): boolean {
  return hasUnsupportedNumber(text, allowed) || hasForbiddenSummary(text);
}

function planHasUnsupportedText(modules: RoadmapModule[]): boolean {
  return modules.some((module) => {
    const moduleNumbers = allowedNumbers(module.chapters);
    return hasUnsupportedText(module.title, moduleNumbers) || hasUnsupportedText(module.subtitle, moduleNumbers) ||
      hasUnsupportedText(module.why, moduleNumbers) || module.chapters.some((chapter) => {
        const chapterNumbers = allowedNumbers([chapter]);
        return hasUnsupportedText(chapter.title, chapterNumbers) || hasUnsupportedText(chapter.outcome, chapterNumbers);
      });
  });
}

function removeUnsupportedSentences(text: string, allowed: Set<string>, fallback: string): string {
  const sentences = text.match(/[^.!?\n]+[.!?]?/gu) ?? [];
  const kept = sentences.filter((sentence) => !hasUnsupportedText(sentence, allowed)).map((sentence) => sentence.trim()).join(" ").trim();
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
  const chapterLimit = CHAPTER_LIMIT[profile.preferences.goal];
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
        'Plan one coherent learning route in prerequisite order, not a survey of every listed requirement. Return only strict JSON: {"modules":[{"title":"string","subtitle":"string","why":"string","chapters":[{"title":"string","category":"code|data|theory|tools|project|soft","skillUris":["exact supplied URI"],"outcome":"string","estimatedHours":number?}]}]}. Use no other keys. Unknown skill URIs are forbidden. A foundation chapter may use an empty skillUris array. Treat the supplied chapterLimit as a ceiling, not a target; use fewer chapters when they cover the route. Prefer broadly transferable, teachable foundations. Do not mix unrelated specialist stacks. A niche requirement seen in only one vacancy is weak evidence and should be omitted unless it is essential to the chosen route. Omit job constraints such as years of experience, geography or employment eligibility. Do not write scores, fit scores, skill matches, percents, probabilities, progress, XP, numeric levels, rankings, or hiring predictions about the seeker. You may copy the supplied employer-demand vacancy counts as facts. Do not put a digit in title, subtitle, why, or outcome unless it exactly copies a supplied vacanciesRequiring or vacanciesTotal fact. Use hoursPerWeek only to shape scope: under-5 means fewer, smaller chapters. Use education only to set the starting depth: education none means start from basics, never lower expectations about ability. estimatedHours is the only numeric time output; do not write schedules or time-to-completion numbers in prose. For learn-fast, use fewer shorter chapters and place projects early. For stability, put the most-demanded skills first within prerequisite constraints. For mission, keep the natural prerequisite order.',
    },
    {
      role: "user" as const,
      content: JSON.stringify({
        occupation: validation.occupation,
        skills,
        goal: profile.preferences.goal,
        languages: profile.preferences.languages,
        hoursPerWeek: profile.preferences.hoursPerWeek,
        education: profile.preferences.education,
        chapterLimit,
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
      maxCompletionTokens: 4_000,
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
  const chapterLimit = CHAPTER_LIMIT[profile.preferences.goal];
  let firstRaw: string;
  try {
    firstRaw = await callPlanner(deps, messages);
  } catch {
    const retryRaw = await callPlanner(deps, messages);
    return sanitizeNumbers(materializePlan(parsePlan(retryRaw), catalog, chapterLimit));
  }
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
    return sanitizeNumbers(materializePlan(parsePlan(firstRaw), catalog, chapterLimit));
  }

  const firstModules = materializePlan(firstPlan, catalog, chapterLimit);
  if (!planHasUnsupportedText(firstModules)) return firstModules;

  const secondRaw = await callPlanner(
    deps,
    messages,
    {
      previous: firstRaw,
      instruction: "Your previous reply introduced a digit that was not copied from demand facts or a forbidden seeker summary such as a score, fit score, skill match, percent, probability, numeric level, progress count, or XP. Retry once. Remove it and return only the exact JSON schema.",
    },
  );
  const secondModules = materializePlan(parsePlan(secondRaw), catalog, chapterLimit);
  return planHasUnsupportedText(secondModules) ? sanitizeNumbers(secondModules) : secondModules;
}
