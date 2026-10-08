import type { ToolSpec } from "../llm";
import { assertUnderCap, recordCost, type PaidTool } from "../ledger";
import { errorMessage } from "../log";

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

/** Runs a tool with the cap check before and the cost record after. Never throws: failures come back as `ok: false`. */
export async function runTool(tool: Tool, params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (!tool.available()) return { ok: false, error: `${tool.name} is not configured (missing API key)`, usd: 0 };
  try {
    if (tool.paid) await assertUnderCap(tool.paid);
    const out = await tool.run(params, ctx);
    if (tool.paid && out.usd > 0) {
      await recordCost({ tool: tool.paid, units: out.units ?? 1, usd: out.usd, runId: ctx.runId, detail: tool.name });
    }
    return { ok: true, ...out };
  } catch (err) {
    return { ok: false, error: errorMessage(err), usd: 0 };
  }
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
