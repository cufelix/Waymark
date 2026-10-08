import type { CareerChoice } from "../contracts.ts";
import { now } from "../core/claims.ts";
import { ApiError } from "../core/errors.ts";
import { touch } from "../core/profile.ts";
import type { ResearchClient } from "../research-client.ts";
import type { SeekerStore } from "../store/store.ts";
import { loadSeeker, updateSeeker } from "./seekers.ts";

export type CareerChoiceDeps = { store: SeekerStore; research: ResearchClient };

export async function setCareerChoice(
  deps: CareerChoiceDeps,
  seekerId: string,
  input: { runId: string; occupationUri: string },
): Promise<CareerChoice> {
  await loadSeeker(deps, seekerId);

  const run = await deps.research.getRun(input.runId);
  if (!run || run.seekerId !== seekerId) throw new ApiError("unprocessable", `runId: ${input.runId} is not a research run for this seeker`);

  const paths = await deps.research.getCareerPaths(input.runId);
  const path = paths?.find((candidate) => candidate.occupation.uri === input.occupationUri);
  if (!path) throw new ApiError("unprocessable", `occupationUri: occupation was not returned by run ${input.runId}`);

  const careerChoice: CareerChoice = {
    occupation: { uri: path.occupation.uri, label: path.occupation.label, lang: path.occupation.lang },
    runId: input.runId,
    chosenAt: now(),
  };
  const record = await updateSeeker(deps, seekerId, (current) => ({
    ...current,
    profile: touch({ ...current.profile, careerChoice }),
  }));
  return record.profile.careerChoice!;
}
