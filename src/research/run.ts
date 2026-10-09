// Research runs: queued in pg-boss, processed by the worker, stored in research_runs.
import { PgBoss } from "pg-boss";
import { config } from "../config";
import {
  ResearchOptions,
  type ResearchOptions as Options,
  type ResearchResult,
  type ResearchRun,
  type RunStep,
  type SeekerProfile,
} from "../contracts";
import { query } from "../db/pool";
import { newId } from "../ids";
import { CapExceededError, costForRun } from "../ledger";
import { LlmUnavailableError } from "../llm";
import { errorMessage, log } from "../log";
import { researchMarket } from "./market/index";
import { researchSeeker } from "./user/index";

export const QUEUE = "research-run";

/** An error with an API error code, raised for problems the caller caused. */
export class RunError extends Error {
  constructor(public readonly code: "unprocessable" | "not_found" | "conflict", message: string) {
    super(message);
  }
}

let boss: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;

export function getBoss(): Promise<PgBoss> {
  if (boss) return Promise.resolve(boss);
  starting ??= (async () => {
    const b = new PgBoss(config.DATABASE_URL);
    b.on("error", (err) => log.error("pg-boss error", { error: errorMessage(err) }));
    await b.start();
    await b.createQueue(QUEUE);
    boss = b;
    return b;
  })();
  return starting;
}

export async function stopBoss(): Promise<void> {
  const b = boss ?? (starting ? await starting : null);
  boss = null;
  starting = null;
  await b?.stop({ graceful: true });
}

/** Starts the worker: up to two runs at a time in this process. */
export async function startWorker(): Promise<void> {
  const b = await getBoss();
  await b.work<{ runId: string }>(QUEUE, { localConcurrency: 2, batchSize: 1 }, async (jobs) => {
    for (const job of jobs) await processRun(job.data.runId);
  });
}

export type RunRow = {
  id: string;
  seeker_id: string;
  profile_version: number;
  profile: SeekerProfile;
  options: Options;
  status: ResearchRun["status"];
  progress: ResearchRun["progress"];
  error: ResearchRun["error"] | null;
  result: ResearchResult | null;
  started_at: Date | null;
  finished_at: Date | null;
};

export async function getRunRow(runId: string): Promise<RunRow | null> {
  const [row] = await query<RunRow>("SELECT * FROM research_runs WHERE id = $1 AND expires_at > now()", [runId]);
  return row ?? null;
}

export async function toRun(row: RunRow): Promise<ResearchRun> {
  return {
    runId: row.id,
    seekerId: row.seeker_id,
    profileVersion: row.profile_version,
    status: row.status,
    progress: row.progress,
    startedAt: row.started_at?.toISOString(),
    finishedAt: row.finished_at?.toISOString(),
    ...(row.error ? { error: row.error } : {}),
    ...(row.status === "done" && row.result ? { result: row.result } : {}),
    cost: await costForRun(row.id),
  };
}

export async function getRun(runId: string): Promise<ResearchRun | null> {
  const row = await getRunRow(runId);
  return row ? toRun(row) : null;
}

/** Stores a queued run and puts it on the queue. Rejects a profile that is not complete. */
export async function startRun(profile: SeekerProfile, options: Partial<Options> = {}): Promise<string> {
  if (profile.status !== "complete") throw new RunError("unprocessable", "profile.status must be \"complete\"");
  if (profile.preferences.targetOccupations.length === 0) {
    throw new RunError("unprocessable", "profile.preferences.targetOccupations needs at least one occupation");
  }
  const opts = ResearchOptions.parse(options);
  const runId = newId("run");
  await query(
    `INSERT INTO research_runs (id, seeker_id, profile_version, profile, options, status, expires_at)
     VALUES ($1, $2, $3, $4, $5, 'queued', now() + ($6 * interval '1 day'))`,
    [runId, profile.seekerId, profile.profileVersion, JSON.stringify(profile), JSON.stringify(opts), config.PERSONAL_DATA_RETENTION_DAYS],
  );
  const b = await getBoss();
  await b.send(QUEUE, { runId }, { expireInSeconds: 60 * 60 });
  return runId;
}

/** Runs the research for one queued run. Never throws: failures are stored on the run. */
export async function processRun(runId: string): Promise<void> {
  const claimed = await query<RunRow>(
    "UPDATE research_runs SET status = 'running', started_at = now() WHERE id = $1 AND status = 'queued' RETURNING *",
    [runId],
  );
  const row = claimed[0];
  if (!row) return; // deleted, cancelled or already processed

  const progress = new Map<RunStep, { done: number; total: number }>();
  let lastFlush = 0;
  let gone = false;
  const flush = async (force = false): Promise<void> => {
    if (gone || (!force && Date.now() - lastFlush < 1000)) return;
    lastFlush = Date.now();
    const list = [...progress].map(([step, p]) => ({ step, ...p }));
    const rows = await query("UPDATE research_runs SET progress = $2 WHERE id = $1 AND status = 'running' RETURNING id", [
      runId, JSON.stringify(list),
    ]);
    if (rows.length === 0) gone = true; // deleted or cancelled meanwhile
  };
  const report = (step: RunStep, done: number, total: number): void => {
    progress.set(step, { done, total });
    flush().catch((err) => log.warn("progress write failed", { runId, error: errorMessage(err) }));
  };

  // The name search runs only when the request asked for it AND the seeker consented.
  const options: Options = { ...row.options, nameSearch: row.options.nameSearch && row.profile.consent.nameSearch };

  try {
    // ponytail: cancellation is checked between steps, an in-flight research call finishes first; add an AbortSignal to the research modules if runs get long
    const [market, seekerResearch] = await Promise.all([
      researchMarket(row.profile, options, runId, report, async (careerPaths) => {
        // Early career paths, readable while the run continues (API.md: career-paths during the run).
        await query("UPDATE research_runs SET result = jsonb_build_object('careerPaths', $2::jsonb) WHERE id = $1 AND status = 'running'", [runId, JSON.stringify(careerPaths)]);
      }),
      researchSeeker(row.profile, options, runId, (done, total) => report("seeker-research", done, total)),
    ]);
    await flush(true);
    if (gone) return;
    const result: ResearchResult = { ...market, seekerResearch };
    await query(
      "UPDATE research_runs SET status = 'done', result = $2, finished_at = now() WHERE id = $1 AND status = 'running'",
      [runId, JSON.stringify(result)],
    );
    log.info("research run done", { runId });
  } catch (err) {
    const code =
      err instanceof CapExceededError ? "cap_exceeded" : err instanceof LlmUnavailableError ? "llm_unavailable" : "internal";
    log.error("research run failed", { runId, code, error: errorMessage(err) });
    await query(
      "UPDATE research_runs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1 AND status = 'running'",
      [runId, JSON.stringify({ code, message: errorMessage(err) })],
    ).catch((e) => log.error("could not store run failure", { runId, error: errorMessage(e) }));
  }
}
