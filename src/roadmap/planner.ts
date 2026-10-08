import type { LlmClient } from "../seeker/llm/llm.ts";
import type { RoadmapModule, SeekerProfile, Validation } from "./contracts.ts";

export type PlannerDeps = { llm: LlmClient };

/** Plans prerequisite-ordered modules and empty-resource chapters using only facts copied from the validation. */
export async function planModules(
  _validation: Validation,
  _profile: SeekerProfile,
  _deps: PlannerDeps,
): Promise<RoadmapModule[]> {
  throw new Error("not implemented");
}
