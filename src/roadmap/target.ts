import type { RoadmapTarget, Validation } from "./contracts.ts";
import { newId } from "../seeker/core/ids.ts";

const LEVEL_ORDER = ["entry", "junior", "mid", "senior", "lead", "executive"] as const;

function levelRank(level: RoadmapTarget["step"]["level"]): number {
  return LEVEL_ORDER.indexOf(level);
}

function locationName(location: Validation["market"][number]["location"]): string {
  return location.city ?? location.country;
}

/** Picks the lowest entry or junior ladder step supported by entry-level market facts; never a probability. */
export function pickTarget(validation: Validation): RoadmapTarget | undefined {
  const ladder = validation.jobProfile.ladder;
  if (!ladder?.length) return undefined;

  const ordered = [...ladder].sort((left, right) => levelRank(left.level) - levelRank(right.level));
  const hasEntryVacancies = validation.market.some(({ entryLevelVacancies }) => entryLevelVacancies > 0);
  const entryStep = ordered.find(({ level }) => level === "entry" || level === "junior");
  const step = hasEntryVacancies && entryStep ? entryStep : ordered[0];

  const marketFacts: RoadmapTarget["facts"] = validation.market
    .filter(({ entryLevelVacancies, entryLevelSources }) => entryLevelVacancies > 0 && entryLevelSources.length > 0)
    .map((market) => ({
      id: newId("clm"),
      subject: { kind: "vacancy" as const, id: validation.runId },
      statement: `${market.entryLevelVacancies} of ${market.openVacancies} ads in ${locationName(market.location)} are for juniors, trainees, or people without experience.`,
      kind: "fact" as const,
      tier: "single-source" as const,
      sources: [...market.entryLevelSources],
    }));

  return { step, facts: [...marketFacts, ...step.claims.filter(({ kind }) => kind === "fact")] };
}
