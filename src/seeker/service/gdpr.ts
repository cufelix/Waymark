import type { SeekerExport } from "../contracts.ts";
import { ApiError } from "../core/errors.ts";
import type { ResearchClient } from "../research-client.ts";
import type { SeekerStore } from "../store/store.ts";

export type GdprDeps = { store: SeekerStore; research: ResearchClient };

const notFound = (seekerId: string): ApiError => new ApiError("not_found", `Seeker ${seekerId} does not exist`);

// GET /v1/seekers/{id}/export: everything stored about the seeker in both parts.
// Works for a deletion-pending seeker too. If Part 2 can't answer, the export fails (502)
// rather than returning something incomplete.
export async function exportSeeker(deps: GdprDeps, seekerId: string): Promise<SeekerExport> {
  const r = await deps.store.get(seekerId);
  if (!r) throw notFound(seekerId);
  const researchRuns = await deps.research.listRuns(seekerId);
  return { profile: r.profile, interview: r.interview, researchRuns };
}

// DELETE /v1/seekers/{id}: hard delete in both parts, Part 2 first.
// The seeker is marked deletion-pending before Part 2 is called, so it disappears from every
// other read at once and stays marked if Part 2 fails (502). Calling delete again retries.
export async function deleteSeeker(deps: GdprDeps, seekerId: string): Promise<{ deleted: true }> {
  const r = await deps.store.get(seekerId);
  if (!r) throw notFound(seekerId);
  if (!r.deletionPending) await deps.store.update(seekerId, (rec) => ({ ...rec, deletionPending: true }));
  try {
    await deps.research.deleteResearch(seekerId);
  } catch (e) {
    const detail = e instanceof ApiError ? e.message : "Part 2 unreachable";
    throw new ApiError("upstream_failed", `Seeker ${seekerId} is marked deletion-pending; research delete failed (${detail}). Retry the delete.`);
  }
  await deps.store.delete(seekerId);
  return { deleted: true };
}
