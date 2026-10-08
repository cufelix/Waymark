import { config } from "./config";
import { query } from "./db/pool";

export type PaidTool = "llm" | "apify" | "exa" | "firecrawl";

const caps: Record<PaidTool, number> = {
  llm: config.CAP_LLM_USD,
  apify: config.CAP_APIFY_USD,
  exa: config.CAP_EXA_USD,
  firecrawl: config.CAP_FIRECRAWL_USD,
};

export class CapExceededError extends Error {
  constructor(public readonly tool: PaidTool, spent: number) {
    super(`Monthly cap for ${tool} reached ($${spent.toFixed(2)} of $${caps[tool]})`);
  }
}

/** Throws before a paid call when this month's spend for the tool has reached its cap. */
export async function assertUnderCap(tool: PaidTool): Promise<void> {
  const [row] = await query<{ usd: string | null }>(
    "SELECT sum(usd) AS usd FROM cost_ledger WHERE tool = $1 AND at >= date_trunc('month', now())",
    [tool],
  );
  const spent = Number(row?.usd ?? 0);
  if (spent >= caps[tool]) throw new CapExceededError(tool, spent);
}

export async function recordCost(entry: { tool: PaidTool; units: number; usd: number; runId?: string; detail?: string }): Promise<void> {
  await query("INSERT INTO cost_ledger (tool, units, usd, run_id, detail) VALUES ($1, $2, $3, $4, $5)", [
    entry.tool, entry.units, entry.usd, entry.runId ?? null, entry.detail ?? null,
  ]);
}

export async function costForRun(runId: string): Promise<{ tool: string; units: number; usd: number }[]> {
  const rows = await query<{ tool: string; units: string; usd: string }>(
    "SELECT tool, sum(units) AS units, sum(usd) AS usd FROM cost_ledger WHERE run_id = $1 GROUP BY tool ORDER BY tool",
    [runId],
  );
  return rows.map((r) => ({ tool: r.tool, units: Number(r.units), usd: Number(r.usd) }));
}
