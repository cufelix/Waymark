import type { ExaClient } from "../seeker/salary/exa.ts";
import type { LlmClient } from "../seeker/llm/llm.ts";
import type { LearningResource, Occupation, Roadmap, RoadmapChapter } from "./contracts.ts";

export interface ResourceCache {
  get(key: string): Promise<LearningResource[] | undefined>;
  set(key: string, value: LearningResource[]): Promise<void>;
}

export class MemoryResourceCache implements ResourceCache {
  private resources = new Map<string, LearningResource[]>();

  async get(key: string): Promise<LearningResource[] | undefined> {
    const value = this.resources.get(key);
    return value === undefined ? undefined : structuredClone(value);
  }

  async set(key: string, value: LearningResource[]): Promise<void> {
    this.resources.set(key, structuredClone(value));
  }
}

export type ResourceDeps = { exa: ExaClient | null; llm: LlmClient; cache: ResourceCache };

/** Finds, verifies and orders resources for one chapter, with free resources first and one optional top pick. */
export async function findResources(
  _chapter: RoadmapChapter,
  _ctx: { occupation: Occupation; goal: Roadmap["goal"]; langs: string[] },
  _deps: ResourceDeps,
): Promise<{ resources: LearningResource[]; topPickId?: string }> {
  throw new Error("not implemented");
}
