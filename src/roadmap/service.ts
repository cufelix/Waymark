import type { ExaClient } from "../seeker/salary/exa.ts";
import type { LlmClient } from "../seeker/llm/llm.ts";
import { ApiError } from "../seeker/core/errors.ts";
import { newId } from "../seeker/core/ids.ts";
import { validateSeekerProfile } from "../seeker/core/validate.ts";
import type { Roadmap, RoadmapChapter, RoadmapProgress, RoadmapRequest } from "./contracts.ts";
import { planModules } from "./planner.ts";
import { findResources, pickTopResource, type ResourceCache } from "./resources.ts";
import type { RoadmapStore } from "./store.ts";
import { pickTarget } from "./target.ts";
import type { ValidationReader } from "./validation-client.ts";

export type RoadmapDeps = {
  store: RoadmapStore;
  validations: ValidationReader;
  llm: LlmClient;
  exa: ExaClient | null;
  cache: ResourceCache;
  resourceCacheTtlHours?: number;
  now?: () => Date;
};

export type RoadmapBuilders = {
  pickTarget: typeof pickTarget;
  planModules: typeof planModules;
  findResources: typeof findResources;
};

export const defaultBuilders: RoadmapBuilders = { pickTarget, planModules, findResources };

export const ROADMAP_BUILD_STALE_MINUTES = 5;

export type BuildingRoadmap = Roadmap & { readonly buildPromise: Promise<void> };

/** Makes interrupted builds terminal after restart so clients never poll a stale building row forever. */
export async function recoverStaleRoadmaps(
  deps: Pick<RoadmapDeps, "store" | "now">,
  staleMinutes = ROADMAP_BUILD_STALE_MINUTES,
): Promise<number> {
  const failedAt = timestamp(deps);
  const cutoff = new Date(new Date(failedAt).getTime() - staleMinutes * 60_000).toISOString();
  return deps.store.failBuildingOlderThan(cutoff, {
    error: {
      code: "build_interrupted",
      message: "Roadmap build was interrupted; create a new roadmap to retry",
    },
    updatedAt: failedAt,
  });
}

function invalid(message: string): never {
  throw new ApiError("unprocessable", message);
}

function validateRequest(value: unknown): RoadmapRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("Request body must be an object");
  const body = value as Record<string, unknown>;
  const allowed = new Set(["validationId", "profile"]);
  const unknown = Object.keys(body).find((key) => !allowed.has(key));
  if (unknown) invalid(`Unknown field: ${unknown}`);
  if (typeof body.validationId !== "string" || !/^val_[0-9A-HJKMNP-TV-Z]{26}$/.test(body.validationId)) {
    invalid("validationId must be a val_ id");
  }
  try {
    return { validationId: body.validationId, profile: validateSeekerProfile(body.profile, "profile") };
  } catch (error) {
    if (error instanceof ApiError) throw new ApiError("unprocessable", error.message);
    throw error;
  }
}

function timestamp(deps: Pick<RoadmapDeps, "now">): string {
  return (deps.now?.() ?? new Date()).toISOString();
}

function safeBuildError(error: unknown): { code: string; message: string } {
  const code = error instanceof ApiError ? error.code : "internal";
  return {
    code,
    message: code === "upstream_failed"
      ? "Roadmap build failed because an upstream service failed"
      : "Roadmap build failed",
  };
}

async function addResources(
  modules: Roadmap["modules"],
  deps: RoadmapDeps,
  request: RoadmapRequest,
  occupation: Roadmap["occupation"],
  builders: RoadmapBuilders,
): Promise<void> {
  const chapters = modules.flatMap((module) => module.chapters);
  const results = new Map<string, Awaited<ReturnType<typeof findResources>>>();
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < chapters.length) {
      const chapter = chapters[next++]!;
      const lookup = () => builders.findResources(
        chapter,
        {
          occupation,
          goal: request.profile.preferences.goal,
          langs: request.profile.preferences.languages.map(({ lang }) => lang),
          courseBudget: request.profile.preferences.courseBudget,
        },
        {
          exa: deps.exa,
          llm: deps.llm,
          cache: deps.cache,
          ...(deps.resourceCacheTtlHours === undefined ? {} : { cacheTtlHours: deps.resourceCacheTtlHours }),
          ...(deps.now === undefined ? {} : { now: deps.now }),
        },
      );
      // One flaky lookup (rate limit, cut-off model reply) must not sink the whole roadmap: retry once, then
      // leave that chapter without resources and let the actionability check below decide.
      let result: Awaited<ReturnType<typeof findResources>> = { resources: [] };
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          result = await lookup();
          if (result.resources.length > 0) break;
        } catch {
          // Retried once; an empty result is handled below.
        }
      }
      results.set(chapter.chapterId, result);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, chapters.length) }, worker));

  const seenUrls = new Set<string>();
  for (const chapter of chapters) {
    const result = results.get(chapter.chapterId) ?? { resources: [] };
    const unseen = result.resources.filter(({ url }) => !seenUrls.has(canonicalResourceUrl(url)));
    // Prefer unique material, but keep one shared resource rather than making a chapter unactionable.
    chapter.resources = unseen.length > 0 ? unseen : result.resources.slice(0, 1);
    for (const { url } of chapter.resources) seenUrls.add(canonicalResourceUrl(url));
    const topPickId = pickTopResource(
      chapter.resources,
      chapter,
      request.profile.preferences.goal,
      request.profile.preferences.courseBudget,
    );
    if (topPickId === undefined) delete chapter.topPickId;
    else chapter.topPickId = topPickId;
  }

  const freeOnly = request.profile.preferences.courseBudget === "free-only";
  if (deps.exa !== null) {
    for (const module of modules) {
      const plannedCount = module.chapters.length;
      module.chapters = module.chapters.filter((chapter) => chapter.done || (
        chapter.resources.length > 0 && (!freeOnly || chapter.resources.some(({ cost }) => cost === "free"))
      ));
      if (module.chapters.length > 0 && module.chapters.length < plannedCount) {
        module.title = module.chapters.length === 1 ? module.chapters[0]!.title : "Verified learning module";
        module.subtitle = module.chapters.length === 1 ? "Actionable chapter" : "Actionable chapters";
        module.why = "Each chapter in this module has a verified learning resource and a practical outcome.";
      }
    }
    modules.splice(0, modules.length, ...modules.filter(({ chapters: kept }) => kept.length > 0));
    if (!modules.some(({ chapters: kept }) => kept.some(({ done }) => !done))) {
      throw new ApiError("upstream_failed", "No unfinished chapter has a verified learning resource");
    }
  }
}

function canonicalResourceUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|fbclid|gclid|ref)$/iu.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/u, "");
    return url.toString();
  } catch {
    return value;
  }
}

/** Stores a building roadmap immediately, then completes its modules and resources in the background. */
export async function createRoadmap(
  deps: RoadmapDeps,
  body: RoadmapRequest,
  builders: RoadmapBuilders = defaultBuilders,
): Promise<BuildingRoadmap> {
  const request = validateRequest(body);
  let validation;
  try {
    validation = await deps.validations.getValidation(request.validationId);
  } catch (error) {
    if (error instanceof ApiError && error.code === "not_found") invalid("validation not found");
    throw error;
  }
  if (validation.seekerId !== request.profile.seekerId) invalid("Validation does not belong to profile.seekerId");

  const createdAt = timestamp(deps);
  const roadmap: Roadmap = {
    roadmapId: newId("rmp"),
    seekerId: request.profile.seekerId,
    validationId: validation.validationId,
    runId: validation.runId,
    occupation: validation.occupation,
    goal: request.profile.preferences.goal,
    status: "building",
    modules: [],
    createdAt,
    updatedAt: createdAt,
  };
  await deps.store.put(roadmap);

  const build = async (): Promise<void> => {
    try {
      const target = builders.pickTarget(validation);
      const modules = await builders.planModules(validation, request.profile, { llm: deps.llm });
      await addResources(modules, deps, request, validation.occupation, builders);
      const ready: Roadmap = {
        ...roadmap,
        status: "ready",
        ...(target === undefined ? {} : { target }),
        modules,
        updatedAt: timestamp(deps),
      };
      await deps.store.replaceIfExists(ready);
    } catch (error) {
      const failed: Roadmap = {
        ...roadmap,
        status: "failed",
        error: safeBuildError(error),
        updatedAt: timestamp(deps),
      };
      await deps.store.replaceIfExists(failed);
    }
  };
  const buildPromise = new Promise<void>((resolve, reject) => {
    setImmediate(() => {
      void build().then(resolve, reject);
    });
  });
  Object.defineProperty(roadmap, "buildPromise", { value: buildPromise, enumerable: false });
  return roadmap as BuildingRoadmap;
}

/** Gets one roadmap or reports that it does not exist. */
export async function getRoadmap(deps: Pick<RoadmapDeps, "store">, roadmapId: string): Promise<Roadmap> {
  const roadmap = await deps.store.get(roadmapId);
  if (!roadmap) throw new ApiError("not_found", `Roadmap ${roadmapId} does not exist`);
  return roadmap;
}

/** Sets the seeker's done tick for one chapter without changing its evidence. */
export async function setProgress(
  deps: Pick<RoadmapDeps, "store" | "now">,
  roadmapId: string,
  chapterId: string,
  body: RoadmapProgress,
): Promise<RoadmapChapter> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) invalid("Request body must be an object");
  const value = body as unknown as Record<string, unknown>;
  const unknown = Object.keys(value).find((key) => key !== "done");
  if (unknown) invalid(`Unknown field: ${unknown}`);
  if (typeof value.done !== "boolean") invalid("done must be a boolean");

  const roadmap = await getRoadmap(deps, roadmapId);
  if (roadmap.status !== "ready") throw new ApiError("conflict", `Roadmap ${roadmapId} is not ready`);
  const chapter = roadmap.modules.flatMap((module) => module.chapters).find((candidate) => candidate.chapterId === chapterId);
  if (!chapter) throw new ApiError("not_found", `Chapter ${chapterId} does not exist`);
  chapter.done = value.done;
  const updatedAt = timestamp(deps);
  if (value.done) {
    chapter.doneBy = "seeker";
    chapter.doneAt = updatedAt;
  } else {
    delete chapter.doneBy;
    delete chapter.doneAt;
  }
  roadmap.updatedAt = updatedAt;
  await deps.store.put(roadmap);
  return structuredClone(chapter);
}

/** Lists every roadmap owned by one seeker. */
export async function listRoadmaps(deps: Pick<RoadmapDeps, "store">, seekerId: string): Promise<Roadmap[]> {
  return deps.store.listBySeeker(seekerId);
}

/** Hard-deletes every roadmap owned by one seeker. */
export async function deleteRoadmaps(
  deps: Pick<RoadmapDeps, "store">,
  seekerId: string,
): Promise<{ deleted: true; roadmaps: number }> {
  return { deleted: true, roadmaps: await deps.store.deleteBySeeker(seekerId) };
}
