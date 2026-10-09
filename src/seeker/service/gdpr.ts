import type { SeekerExport } from "../contracts.ts";
import { ApiError } from "../core/errors.ts";
import { log } from "../../log.ts";
import { loadDeck } from "../intake/deck.ts";
import { publicIntake, type IntakeViewDeps } from "../intake/service.ts";
import type { ResearchClient } from "../research-client.ts";
import { roadmapClientFromEnv, type RoadmapClient } from "../roadmap-client.ts";
import type { SeekerStore } from "../store/store.ts";
import type { DeletionQueue } from "../store/deletion-jobs.ts";
import { validationClientFromEnv, type ValidationClient } from "../validation-client.ts";

export type GdprDeps = {
  store: SeekerStore;
  research: ResearchClient;
  validations?: ValidationClient;
  roadmaps?: RoadmapClient;
  intake?: Partial<IntakeViewDeps>;
  deletions?: DeletionQueue;
};

const notFound = (seekerId: string): ApiError => new ApiError("not_found", `Seeker ${seekerId} does not exist`);

// GET /v1/seekers/{id}/export: everything stored about the seeker across all four parts.
// Works for a deletion-pending seeker too. If an upstream part can't answer, the export fails (502)
// rather than returning something incomplete.
export async function exportSeeker(deps: GdprDeps, seekerId: string): Promise<SeekerExport> {
  const r = await deps.store.get(seekerId);
  if (!r) throw notFound(seekerId);
  const researchRuns = await deps.research.listRuns(seekerId);
  const validations = await (deps.validations ?? validationClientFromEnv())?.list(seekerId) ?? [];
  const roadmaps = await (deps.roadmaps ?? roadmapClientFromEnv())?.list(seekerId) ?? [];
  const storedIntake = await deps.store.getIntake(seekerId);
  const intake = storedIntake
    ? publicIntake(
        {
          loadDeck: deps.intake?.loadDeck ?? loadDeck,
          ...(deps.intake?.engine ? { engine: deps.intake.engine } : {}),
        },
        storedIntake,
      )
    : undefined;
  return {
    profile: r.profile,
    interview: r.interview,
    ...(intake ? { intake } : {}),
    researchRuns,
    validations,
    roadmaps,
  };
}

// DELETE /v1/seekers/{id}: hard delete in every part, Part 4 then Part 3 then Part 2 then Part 1.
// The seeker is marked deletion-pending before any upstream is called, so it disappears from
// every other read at once and stays marked if an upstream fails (502). Calling delete again retries.
export async function deleteSeeker(deps: GdprDeps, seekerId: string): Promise<{ deleted: true }> {
  const r = await deps.store.get(seekerId);
  if (!r) throw notFound(seekerId);
  await deps.deletions?.request(seekerId);
  if (!r.deletionPending) await deps.store.update(seekerId, (rec) => ({ ...rec, deletionPending: true }));
  const roadmaps = deps.roadmaps ?? roadmapClientFromEnv();
  if (roadmaps) {
    try {
      await roadmaps.deleteAll(seekerId);
    } catch (e) {
      await deps.deletions?.fail(seekerId, "roadmap_delete_failed");
      const detail = e instanceof ApiError ? e.message : "Part 4 unreachable";
      throw new ApiError("upstream_failed", `Seeker ${seekerId} is marked deletion-pending; roadmap delete failed (${detail}). Retry the delete.`);
    }
  }
  const validations = deps.validations ?? validationClientFromEnv();
  if (validations) {
    try {
      await validations.deleteAll(seekerId);
    } catch (e) {
      await deps.deletions?.fail(seekerId, "validation_delete_failed");
      const detail = e instanceof ApiError ? e.message : "Part 3 unreachable";
      throw new ApiError("upstream_failed", `Seeker ${seekerId} is marked deletion-pending; validation delete failed (${detail}). Retry the delete.`);
    }
  }
  try {
    await deps.research.deleteResearch(seekerId);
  } catch (e) {
    await deps.deletions?.fail(seekerId, "research_delete_failed");
    const detail = e instanceof ApiError ? e.message : "Part 2 unreachable";
    throw new ApiError("upstream_failed", `Seeker ${seekerId} is marked deletion-pending; research delete failed (${detail}). Retry the delete.`);
  }
  await deps.store.delete(seekerId);
  await deps.deletions?.complete(seekerId);
  return { deleted: true };
}

export async function retryDeletionJobs(deps: GdprDeps, limit = 10): Promise<{ completed: number; failed: number }> {
  if (!deps.deletions) return { completed: 0, failed: 0 };
  const seekerIds = await deps.deletions.claimDue(limit);
  let completed = 0;
  let failed = 0;
  for (const seekerId of seekerIds) {
    try {
      await deleteSeeker(deps, seekerId);
      completed++;
    } catch (error) {
      if (error instanceof ApiError && error.code === "not_found") {
        await deps.deletions.complete(seekerId);
        completed++;
      } else {
        failed++;
      }
    }
  }
  return { completed, failed };
}

export function startDeletionRetryWorker(deps: GdprDeps, intervalSeconds = 60): () => void {
  const run = (): void => {
    retryDeletionJobs(deps)
      .then(({ completed, failed }) => {
        if (completed > 0 || failed > 0) log.info("seeker deletion retries processed", { completed, failed });
      })
      .catch(() => log.error("seeker deletion retry worker failed"));
  };
  run();
  const timer = setInterval(run, intervalSeconds * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
