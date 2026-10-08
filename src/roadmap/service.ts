import type { ExaClient } from "../seeker/salary/exa.ts";
import type { LlmClient } from "../seeker/llm/llm.ts";
import { ApiError } from "../seeker/core/errors.ts";
import { newId } from "../seeker/core/ids.ts";
import { validateSeekerProfile } from "../seeker/core/validate.ts";
import type { Roadmap, RoadmapChapter, RoadmapProgress, RoadmapRequest } from "./contracts.ts";
import { planModules } from "./planner.ts";
import { findResources, type ResourceCache } from "./resources.ts";
import type { RoadmapStore } from "./store.ts";
import { pickTarget } from "./target.ts";
import type { ValidationReader } from "./validation-client.ts";

export type RoadmapDeps = {
  store: RoadmapStore;
  validations: ValidationReader;
  llm: LlmClient;
  exa: ExaClient | null;
  cache: ResourceCache;
  now?: () => Date;
};

export type RoadmapBuilders = {
  pickTarget: typeof pickTarget;
  planModules: typeof planModules;
  findResources: typeof findResources;
};

export const defaultBuilders: RoadmapBuilders = { pickTarget, planModules, findResources };

export type BuildingRoadmap = Roadmap & { readonly buildPromise: Promise<void> };

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
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < chapters.length) {
      const chapter = chapters[next++];
      const result = await builders.findResources(
        chapter,
        {
          occupation,
          goal: request.profile.preferences.goal,
          langs: request.profile.preferences.languages.map(({ lang }) => lang),
        },
        { exa: deps.exa, llm: deps.llm, cache: deps.cache },
      );
      chapter.resources = result.resources;
      if (result.topPickId === undefined) delete chapter.topPickId;
      else chapter.topPickId = result.topPickId;
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, chapters.length) }, worker));
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
      await deps.store.put(ready);
    } catch (error) {
      const failed: Roadmap = {
        ...roadmap,
        status: "failed",
        error: safeBuildError(error),
        updatedAt: timestamp(deps),
      };
      await deps.store.put(failed);
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
