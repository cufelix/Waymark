// Recipes: how to read a kind of input, learned once by an agent and replayed afterwards without the model.
import { query } from "../db/pool";
import { log } from "../log";
import { runTool, type Tool, type ToolResult } from "../tools/types";
import type { CallRecord } from "./loop";

export type RecipeStep = { tool: string; params: Record<string, unknown> };

export type Recipe = {
  key: string;
  steps: RecipeStep[];
  outputMap: Record<string, string>;
  expectedShape: string[];
  runs: number;
  successes: number;
  usdPerRun: number;
  status: "learned" | "pinned" | "disabled";
};

export type Vars = Record<string, string>;

type Row = {
  key: string; steps: RecipeStep[]; output_map: Record<string, string>; expected_shape: string[];
  runs: number; successes: number; usd_per_run: string; status: Recipe["status"];
};

const fromRow = (r: Row): Recipe => ({
  key: r.key, steps: r.steps, outputMap: r.output_map, expectedShape: r.expected_shape,
  runs: r.runs, successes: r.successes, usdPerRun: Number(r.usd_per_run), status: r.status,
});

export async function getRecipe(key: string): Promise<Recipe | null> {
  const [row] = await query<Row>("SELECT * FROM recipes WHERE key = $1 AND status <> 'disabled'", [key]);
  return row ? fromRow(row) : null;
}

export async function saveRecipe(r: Pick<Recipe, "key" | "steps" | "expectedShape"> & { outputMap?: Record<string, string>; usdPerRun: number }): Promise<void> {
  await query(
    `INSERT INTO recipes (key, steps, output_map, expected_shape, runs, successes, last_success_at, usd_per_run)
     VALUES ($1, $2, $3, $4, 1, 1, now(), $5)
     ON CONFLICT (key) DO UPDATE SET steps = EXCLUDED.steps, output_map = EXCLUDED.output_map,
       expected_shape = EXCLUDED.expected_shape, usd_per_run = EXCLUDED.usd_per_run, status = 'learned', updated_at = now()
     WHERE recipes.status <> 'pinned'`,
    [r.key, JSON.stringify(r.steps), JSON.stringify(r.outputMap ?? {}), JSON.stringify(r.expectedShape), r.usdPerRun],
  );
}

export async function setOutputMap(key: string, outputMap: Record<string, string>): Promise<void> {
  await query("UPDATE recipes SET output_map = $2, updated_at = now() WHERE key = $1", [key, JSON.stringify(outputMap)]);
}

async function recordReplay(key: string, ok: boolean, usd: number): Promise<void> {
  await query(
    `UPDATE recipes SET runs = runs + 1, successes = successes + $2::int,
       last_success_at = CASE WHEN $2::int = 1 THEN now() ELSE last_success_at END,
       usd_per_run = (usd_per_run * runs + $3) / (runs + 1), updated_at = now()
     WHERE key = $1`,
    [key, ok ? 1 : 0, usd],
  );
  // A learned recipe that failed more often than it worked is dropped; the agent learns a new one.
  if (!ok) await query("DELETE FROM recipes WHERE key = $1 AND status = 'learned' AND successes * 2 < runs", [key]);
}

/** Replaces each variable's value inside string params with its {placeholder}, longest value first. */
export function templatize(params: Record<string, unknown>, vars: Vars): Record<string, unknown> {
  const entries = Object.entries(vars).filter(([, v]) => v.length >= 2).sort((a, b) => b[1].length - a[1].length);
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return entries.reduce((s, [name, val]) => s.split(val).join(`{${name}}`), v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(params) as Record<string, unknown>;
}

/** Fills {placeholders} in string params with the variables of this input. */
export function fill(params: Record<string, unknown>, vars: Vars): Record<string, unknown> {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return v.replace(/\{(\w+)\}/g, (m, name: string) => vars[name] ?? m);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(params) as Record<string, unknown>;
}

/** The keys of the first record in a tool's raw output: used to notice when a site changes its shape. */
export function shapeOf(raw: unknown): string[] {
  const first = Array.isArray(raw) ? raw[0] : raw;
  return first && typeof first === "object" ? Object.keys(first as object).sort() : [];
}

export function shapeMatches(expected: string[], raw: unknown): boolean {
  if (expected.length === 0) return true;
  const actual = new Set(shapeOf(raw));
  return expected.filter((k) => actual.has(k)).length * 2 >= expected.length;
}

/** Builds recipe steps from the calls the agent marked as useful. */
export function stepsFromCalls(calls: CallRecord[], usedCalls: number[], vars: Vars): RecipeStep[] {
  return usedCalls
    .map((i) => calls[i])
    .filter((c): c is CallRecord => !!c && c.result.ok)
    .map((c) => ({ tool: c.tool, params: templatize(c.params, vars) }));
}

/**
 * Replays a recipe. Returns the successful results, or null when a step fails or the output drifted,
 * in which case the caller should let the agent explore again.
 */
export async function replay(
  recipe: Recipe,
  vars: Vars,
  tools: Map<string, Tool>,
  runId?: string,
): Promise<Extract<ToolResult, { ok: true }>[] | null> {
  const results: Extract<ToolResult, { ok: true }>[] = [];
  let usd = 0;
  for (const step of recipe.steps) {
    const tool = tools.get(step.tool);
    const res: ToolResult = tool ? await runTool(tool, fill(step.params, vars), { runId }) : { ok: false, error: `unknown tool ${step.tool}`, usd: 0 };
    usd += res.usd;
    if (!res.ok) {
      log.warn("recipe step failed", { key: recipe.key, tool: step.tool, error: res.error });
      await recordReplay(recipe.key, false, usd);
      return null;
    }
    results.push(res);
  }
  const last = results.at(-1);
  if (!last || !shapeMatches(recipe.expectedShape, last.raw)) {
    log.warn("recipe output drifted", { key: recipe.key });
    await recordReplay(recipe.key, false, usd);
    return null;
  }
  await recordReplay(recipe.key, true, usd);
  return results;
}
