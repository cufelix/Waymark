import type { ExaClient } from "../seeker/salary/exa.ts";
import type { LlmClient } from "../seeker/llm/llm.ts";
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

/** Stores a building roadmap immediately, then completes its modules and resources in the background. */
export async function createRoadmap(
  _deps: RoadmapDeps,
  _body: RoadmapRequest,
  _builders: RoadmapBuilders = defaultBuilders,
): Promise<Roadmap> {
  throw new Error("not implemented");
}

/** Gets one roadmap or reports that it does not exist. */
export async function getRoadmap(_deps: Pick<RoadmapDeps, "store">, _roadmapId: string): Promise<Roadmap> {
  throw new Error("not implemented");
}

/** Sets the seeker's done tick for one chapter without changing its evidence. */
export async function setProgress(
  _deps: Pick<RoadmapDeps, "store" | "now">,
  _roadmapId: string,
  _chapterId: string,
  _body: RoadmapProgress,
): Promise<RoadmapChapter> {
  throw new Error("not implemented");
}

/** Lists every roadmap owned by one seeker. */
export async function listRoadmaps(_deps: Pick<RoadmapDeps, "store">, _seekerId: string): Promise<Roadmap[]> {
  throw new Error("not implemented");
}

/** Hard-deletes every roadmap owned by one seeker. */
export async function deleteRoadmaps(
  _deps: Pick<RoadmapDeps, "store">,
  _seekerId: string,
): Promise<{ deleted: true; roadmaps: number }> {
  throw new Error("not implemented");
}
