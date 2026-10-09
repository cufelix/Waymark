import { config } from "./config";
import { pool, query } from "./db/pool";

export type PaidTool = "llm" | "apify" | "exa" | "firecrawl";

const caps: Record<PaidTool, number> = {
  llm: config.CAP_LLM_USD,
  apify: config.CAP_APIFY_USD,
  exa: config.CAP_EXA_USD,
  firecrawl: config.CAP_FIRECRAWL_USD,
};

/** Upper-bound cost reserved before a call, so concurrent calls can't overshoot the cap together. */
export const ESTIMATE_USD: Record<PaidTool, number> = { llm: 0.05, apify: 0.25, exa: 0.02, firecrawl: 0.01 };

export class CapExceededError extends Error {
  constructor(public readonly tool: PaidTool, spent: number) {
    super(`Monthly cap for ${tool} reached ($${spent.toFixed(2)} of $${caps[tool]})`);
  }
}

/**
 * Atomically checks this month's spend plus the estimate against the cap and inserts a pending row.
 * Returns the row id; settle it with the real cost afterwards.
 */
export async function reserveCost(tool: PaidTool, opts: { estimateUsd?: number; runId?: string; detail?: string } = {}): Promise<number> {
  const estimate = opts.estimateUsd ?? ESTIMATE_USD[tool];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`cost:${tool}`]);
    const { rows } = await client.query<{ usd: string | null }>(
      "SELECT sum(usd) AS usd FROM cost_ledger WHERE tool = $1 AND at >= date_trunc('month', now())",
      [tool],
    );
    const spent = Number(rows[0]?.usd ?? 0);
    if (spent + estimate > caps[tool]) throw new CapExceededError(tool, spent);
    const ins = await client.query<{ id: string }>(
      "INSERT INTO cost_ledger (tool, units, usd, run_id, detail) VALUES ($1, 0, $2, $3, $4) RETURNING id",
      [tool, estimate, opts.runId ?? null, `pending:${opts.detail ?? ""}`],
    );
    await client.query("COMMIT");
    return Number(ins.rows[0]!.id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Replaces a reservation with the real cost. Pass null to keep the estimate (cost unknown). */
export async function settleCost(id: number, actual: { usd: number | null; units: number; detail?: string }): Promise<void> {
  await query(
    "UPDATE cost_ledger SET usd = COALESCE($2, usd), units = $3, detail = COALESCE($4, replace(detail, 'pending:', '')) WHERE id = $1",
    [id, actual.usd, actual.units, actual.detail ?? null],
  );
}

/** Drops a reservation for a call that never reached the paid service. */
export async function releaseCost(id: number): Promise<void> {
  await query("DELETE FROM cost_ledger WHERE id = $1", [id]);
}

export async function costForRun(runId: string): Promise<{ tool: string; units: number; usd: number }[]> {
  const rows = await query<{ tool: string; units: string; usd: string }>(
    "SELECT tool, sum(units) AS units, sum(usd) AS usd FROM cost_ledger WHERE run_id = $1 GROUP BY tool ORDER BY tool",
    [runId],
  );
  return rows.map((r) => ({ tool: r.tool, units: Number(r.units), usd: Number(r.usd) }));
}
