import type { ToolSpec } from "../llm";
import { releaseCost, reserveCost, settleCost, type PaidTool } from "../ledger";
import { errorMessage, log } from "../log";
import { assertPublicUrl } from "./net";

/** What every tool returns. `text` is what the agent and the extractors read; `raw` is kept for recipes and snapshots. */
export type ToolOutput = {
  raw: unknown;
  text: string;
  url?: string;          // the page or resource this came from, when there is one
  usd: number;
  units?: number;
};

export type ToolResult = ({ ok: true } & ToolOutput) | { ok: false; error: string; usd: number };

export type ToolContext = { runId?: string };

export interface Tool<P = Record<string, unknown>> {
  name: string;
  description: string;
  parameters: Record<string, unknown>;   // JSON Schema for the agent
  paid?: PaidTool;                        // set for tools that cost money
  available(): boolean;                   // false when its API key is missing
  run(params: P, ctx: ToolContext): Promise<ToolOutput>;
}

/** Every string inside params that looks like an http(s) URL. */
export function urlsIn(value: unknown, found: string[] = []): string[] {
  if (typeof value === "string") {
    for (const m of value.matchAll(/https?:\/\/[^\s"'<>]+/gi)) found.push(m[0]);
  } else if (Array.isArray(value)) {
    value.forEach((v) => urlsIn(v, found));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((v) => urlsIn(v, found));
  }
  return found;
}

/**
 * Runs a tool: every URL in its params must be public (SSRF guard, also for URLs handed to Apify,
 * Firecrawl or Exa), paid tools reserve their cost before the call and settle it after.
 * Never throws: failures come back as `ok: false`.
 */
export async function runTool(tool: Tool, params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (!tool.available()) return { ok: false, error: `${tool.name} is not configured (missing API key)`, usd: 0 };
  let reservation: number | undefined;
  try {
    for (const u of urlsIn(params)) await assertPublicUrl(new URL(u));
    if (tool.paid) reservation = await reserveCost(tool.paid, { runId: ctx.runId, detail: tool.name });
  } catch (err) {
    return { ok: false, error: errorMessage(err), usd: 0 };
  }
  let out: ToolOutput;
  try {
    out = await tool.run(params, ctx);
  } catch (err) {
    if (reservation !== undefined) await releaseCost(reservation).catch(() => undefined);
    return { ok: false, error: errorMessage(err), usd: 0 };
  }
  if (reservation !== undefined) {
    // A failed ledger write must not throw away a result we already paid for.
    await settleCost(reservation, { usd: out.usd, units: out.units ?? 1, detail: tool.name }).catch((err: unknown) =>
      log.error("cost settle failed", { tool: tool.name, error: errorMessage(err) }),
    );
  }
  return { ok: true, ...out };
}

export const toolSpec = (tool: Tool): ToolSpec => ({
  type: "function",
  function: { name: tool.name, description: tool.description, parameters: tool.parameters },
});

/** Shortens long tool text for the model, keeping the start and the end. */
export function clip(text: string, max = 6000): string {
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  return `${text.slice(0, half)}\n…[${text.length - max} characters cut]…\n${text.slice(-half)}`;
}
