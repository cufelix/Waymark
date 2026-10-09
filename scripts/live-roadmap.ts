// Builds one end-to-end roadmap from live public market/resource data and writes the full output under data/.
// This spends provider credits. Example:
//   pnpm exec tsx scripts/live-roadmap.ts test/api/fixtures/junior-backend.json --max 12
// Reuse an existing validation (and its paid research) with:
//   pnpm exec tsx scripts/live-roadmap.ts test/api/fixtures/junior-backend.json --validation val_...
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

if (existsSync(".env")) process.loadEnvFile(".env");
process.env.API_KEYS ||= "live-roadmap-local-only";

const args = process.argv.slice(2);
const maxAt = args.indexOf("--max");
const validationAt = args.indexOf("--validation");
const maxVacancies = maxAt >= 0 ? Number(args[maxAt + 1]) : 12;
const existingValidationId = validationAt >= 0 ? args[validationAt + 1] : undefined;
const profilePath = args.find((arg, index) => (
  !arg.startsWith("--") && index !== maxAt + 1 && index !== validationAt + 1
))
  ?? "test/api/fixtures/junior-backend.json";
if (!Number.isInteger(maxVacancies) || maxVacancies < 3 || maxVacancies > 50) {
  throw new Error("--max must be an integer from 3 to 50");
}
if (!process.env.OPENROUTER_API_KEY || !process.env.EXA_API_KEY) {
  throw new Error("OPENROUTER_API_KEY and EXA_API_KEY are required");
}
if (validationAt >= 0 && (!existingValidationId || !/^val_[0-9A-HJKMNP-TV-Z]{26}$/iu.test(existingValidationId))) {
  throw new Error("--validation must be followed by a validation id");
}

const [{ createApp }, { config }, { SeekerProfile }, { migrate }, db, seekerIds] = await Promise.all([
  import("../src/api/app.ts"),
  import("../src/config.ts"),
  import("../src/contracts.ts"),
  import("../src/db/migrate.ts"),
  import("../src/db/pool.ts"),
  import("../src/seeker/core/ids.ts"),
]);
const [{ getRun, processRun, startRun, stopBoss }, { HttpPart2Client }, { PostgresGapStore }, gapService] = await Promise.all([
  import("../src/research/run.ts"),
  import("../src/gap/part2-client.ts"),
  import("../src/gap/postgres-store.ts"),
  import("../src/gap/service.ts"),
]);
const [{ HttpValidationReader }, { PostgresRoadmapStore }, resources, roadmapService, llm, salary] = await Promise.all([
  import("../src/roadmap/validation-client.ts"),
  import("../src/roadmap/postgres-store.ts"),
  import("../src/roadmap/resources.ts"),
  import("../src/roadmap/service.ts"),
  import("../src/seeker/llm/llm.ts"),
  import("../src/seeker/salary/exa.ts"),
]);
const { validateSeekerProfile } = await import("../src/seeker/core/validate.ts");

const out = (message: string): void => void process.stdout.write(message + "\n");
await migrate();
const validations = new PostgresGapStore(db.pool, config.PERSONAL_DATA_RETENTION_DAYS);
const existingValidation = existingValidationId ? await validations.get(existingValidationId) : null;
if (existingValidationId && !existingValidation) throw new Error(`validation not found: ${existingValidationId}`);

const input = JSON.parse(readFileSync(profilePath, "utf8")) as Record<string, unknown>;
const at = new Date().toISOString();
const seekerId = existingValidation?.seekerId ?? seekerIds.newId("skr");
const rawProfile = {
  ...input,
  seekerId,
  profileVersion: existingValidation?.profileVersion ?? 1,
  consent: { dataProcessing: true, nameSearch: false, givenAt: at, policyVersion: "live-evaluation-v1" },
  preferences: {
    ...(input.preferences as Record<string, unknown>),
    languages: [{ lang: "en", level: "fluent" }, { lang: "cs", level: "native" }],
    hoursPerWeek: "5-10",
    courseBudget: "some",
    education: "secondary",
  },
  statedSkills: [],
  documents: [],
  links: [],
  updatedAt: at,
};
delete (rawProfile as { careerChoice?: unknown }).careerChoice;
const roadmapProfile = validateSeekerProfile(rawProfile, "profile");
const researchProfile = SeekerProfile.parse(rawProfile);

try {
  const runId = existingValidation?.runId ?? await startRun(researchProfile, {
      maxVacancies,
      maxCompanies: 3,
      sources: ["exa"],
      nameSearch: false,
    });
  if (existingValidation) {
    out(`reusing validation ${existingValidation.validationId} and research ${runId}`);
  } else {
    out(`research ${runId} started (${profilePath}, max ${maxVacancies})`);
    await processRun(runId);
  }
  const run = await getRun(runId);
  if (!run || run.status !== "done" || !run.result) {
    throw new Error(`research did not finish: ${run?.status ?? "missing"}${run?.error ? ` (${run.error.code})` : ""}`);
  }
  if (run.result.vacancyIds.length === 0) throw new Error("live research returned no vacancies");

  const app = createApp({ rateLimitPerMinute: 10_000 });
  const localFetch: typeof fetch = async (input, init) => app.request(String(input), init);
  const apiKey = process.env.API_KEYS.split(",")[0]!;
  const baseUrl = "http://waymark.local";
  const part2 = new HttpPart2Client({ baseUrl, apiKey, fetchImpl: localFetch, timeoutMs: 30_000 });
  const occupationUri = roadmapProfile.preferences.targetOccupations[0]!.uri;
  const validation = existingValidation ?? await gapService.createValidation(
      { store: validations, part2 },
      { profile: roadmapProfile, runId, occupationUri },
    );
  if (validation.jobProfile.vacanciesAnalysed === 0) throw new Error("validation analysed no vacancies");

  const validationReader = new HttpValidationReader({ baseUrl, apiKey, fetchImpl: localFetch, timeoutMs: 30_000 });
  const roadmaps = new PostgresRoadmapStore(db.pool, config.PERSONAL_DATA_RETENTION_DAYS);
  const exa = salary.exaFromEnv();
  if (!exa) throw new Error("EXA_API_KEY is not set");
  let resourceLookup = 0;
  const builders = {
    pickTarget: roadmapService.defaultBuilders.pickTarget,
    planModules: async (...params: Parameters<typeof roadmapService.defaultBuilders.planModules>) => {
      const startedAt = Date.now();
      out("planning roadmap modules");
      const modules = await roadmapService.defaultBuilders.planModules(...params);
      out(`planned ${modules.length} modules in ${Math.round((Date.now() - startedAt) / 1_000)}s`);
      return modules;
    },
    findResources: async (...params: Parameters<typeof roadmapService.defaultBuilders.findResources>) => {
      const lookup = ++resourceLookup;
      const result = await roadmapService.defaultBuilders.findResources(...params);
      out(`resource lookup ${lookup} (${params[0].title}): ${result.resources.length} verified`);
      return result;
    },
  };
  const building = await roadmapService.createRoadmap({
    store: roadmaps,
    validations: validationReader,
    llm: new llm.OpenRouterClient(),
    exa,
    cache: new resources.MemoryResourceCache(),
    resourceCacheTtlHours: config.RESOURCE_CACHE_TTL_HOURS,
  }, { validationId: validation.validationId, profile: roadmapProfile }, builders);
  await building.buildPromise;
  const roadmap = await roadmaps.get(building.roadmapId);
  if (!roadmap || roadmap.status !== "ready") {
    throw new Error(`roadmap did not finish: ${roadmap?.status ?? "missing"}${roadmap?.error ? ` (${roadmap.error.code})` : ""}`);
  }

  const chapters = roadmap.modules.flatMap(({ chapters }) => chapters);
  const resourcesFound = chapters.flatMap(({ resources }) => resources);
  const demandSources = validation.skills.flatMap(({ demand }) => demand.sources);
  const nonLiveUrl = [...resourcesFound.map(({ url }) => url), ...demandSources.map(({ url }) => url)]
    .find((url) => !/^https?:\/\//u.test(url) || /(?:^|\.)example\.com(?:\/|$)/iu.test(new URL(url).hostname));
  if (nonLiveUrl) throw new Error("evaluation found a non-live source URL");
  if (chapters.some((chapter) => !chapter.done && chapter.resources.length === 0)) {
    throw new Error("ready roadmap contains an unfinished chapter without resources");
  }

  const outputPath = resolve("data/evaluations", `live-roadmap-${roadmap.roadmapId}.json`);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    input: existingValidationId
      ? { fixture: profilePath, reusedValidationId: existingValidationId }
      : { fixture: profilePath, maxVacancies },
    research: run,
    validation,
    roadmap,
    checks: {
      vacanciesAnalysed: validation.jobProfile.vacanciesAnalysed,
      chapters: chapters.length,
      unfinishedChapters: chapters.filter(({ done }) => !done).length,
      resources: resourcesFound.length,
      demandSources: demandSources.length,
      allUnfinishedChaptersActionable: true,
      allCheckedUrlsLiveShaped: true,
    },
  }, null, 2) + "\n");

  const totalCost = run.cost.reduce((sum, entry) => sum + entry.usd, 0);
  out(`validation ${validation.validationId}: ${validation.jobProfile.vacanciesAnalysed} vacancies, ${validation.skills.length} skill checks`);
  out(`roadmap ${roadmap.roadmapId}: ${roadmap.modules.length} modules, ${chapters.length} chapters, ${resourcesFound.length} resources`);
  out(`recorded research cost: $${totalCost.toFixed(4)}`);
  out(`output: ${outputPath}`);
} finally {
  await stopBoss();
  await db.pool.end();
}
