import type { RoadmapTarget, Validation } from "./contracts.ts";

/** Picks the lowest entry or junior ladder step supported by entry-level market facts; never a probability. */
export function pickTarget(_validation: Validation): RoadmapTarget | undefined {
  throw new Error("not implemented");
}
