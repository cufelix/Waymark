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

const NEUTRAL_ERROR = /cap .*reached|not configured|Blocked|timed? ?out|ECONN|ENOTFOUND|fetch failed/i;

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

/**
 * Saves a learned recipe unless one already exists for the key (a recipe is only replaced after it has
 * failed and been deleted). Rejects steps that fail validateSteps, so a poisoned run can't store a recipe.
 */
export async function saveRecipe(r: Pick<Recipe, "key" | "steps" | "expectedShape"> & { outputMap?: Record<string, string>; usdPerRun: number }): Promise<boolean> {
  const problem = validateSteps(r.key, r.steps) ?? (r.expectedShape.length === 0 ? "empty expected shape" : null);
  if (problem) {
    log.warn("recipe rejected", { key: r.key, problem });
    return false;
  }
  await query(
    `INSERT INTO recipes (key, steps, output_map, expected_shape, runs, successes, last_success_at, usd_per_run)
     VALUES ($1, $2, $3, $4, 1, 1, now(), $5)
     ON CONFLICT (key) DO NOTHING`,
    [r.key, JSON.stringify(r.steps), JSON.stringify(r.outputMap ?? {}), JSON.stringify(r.expectedShape), r.usdPerRun],
  );
  return true;
}

/** Tools a recipe may replay. Anything else (or a new tool) needs a person to pin it. */
const RECIPE_TOOLS = new Set([
  "fetch_url", "firecrawl_scrape", "firecrawl_map", "github_api", "apify_run_actor", "exa_search", "exa_contents", "free_jobs_search", "gleif_search",
]);

/**
 * Returns why steps are unsafe to store or replay, or null when they are fine:
 * only allowed tools, and every URL either comes from a {placeholder} or stays on the key's own host.
 */
export function validateSteps(key: string, steps: RecipeStep[]): string | null {
  if (steps.length === 0 || steps.length > 5) return "a recipe needs 1 to 5 steps";
  const keyHost = key.startsWith("url:") ? key.slice(4).split("/")[0] : undefined;
  for (const step of steps) {
    if (!RECIPE_TOOLS.has(step.tool)) return `tool ${step.tool} is not allowed in recipes`;
    for (const raw of urlStrings(step.params)) {
      if (raw.startsWith("{")) continue; // the input's own URL, filled at replay time
      let host: string;
      try {
        host = new URL(raw.replace(/\{\w+\}/g, "x")).hostname.replace(/^www\./, "");
      } catch {
        return `unparseable URL ${raw.slice(0, 80)}`;
      }
      if (!keyHost || (host !== keyHost && !host.endsWith(`.${keyHost}`))) return `literal URL to ${host} is not allowed`;
    }
  }
  return null;
}

function urlStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") {
    if (/^\{\w+\}/.test(v) && /url/i.test(v)) out.push(v);
    for (const m of v.matchAll(/https?:\/\/[^\s"'<>]+/gi)) out.push(m[0]);
  } else if (Array.isArray(v)) v.forEach((x) => urlStrings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => urlStrings(x, out));
  return out;
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

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Replaces each variable's value inside string params with its {placeholder}, in one pass (longest value
 * first, so replacements are never re-scanned). Literal braces are escaped as {{ and }}.
 */
export function templatize(params: Record<string, unknown>, vars: Vars): Record<string, unknown> {
  const entries = Object.entries(vars).filter(([, v]) => v.length >= 3).sort((a, b) => b[1].length - a[1].length);
  const byValue = new Map(entries.map(([name, val]) => [val, name]));
  const re = entries.length ? new RegExp(entries.map(([, v]) => escapeRe(v)).join("|"), "g") : null;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const escaped = v.replace(/[{}]/g, (b) => b + b);
      return re ? escaped.replace(re, (m) => `{${byValue.get(m)}}`) : escaped;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(params) as Record<string, unknown>;
}

/** Fills {placeholders} in string params with this input's variables and unescapes {{ and }}. */
export function fill(params: Record<string, unknown>, vars: Vars): Record<string, unknown> {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      return v.replace(/\{\{|\}\}|\{(\w+)\}/g, (m, name: string | undefined) =>
        m === "{{" ? "{" : m === "}}" ? "}" : name && Object.hasOwn(vars, name) ? vars[name]! : m,
      );
    }
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
  const problem = validateSteps(recipe.key, recipe.steps);
  if (problem) {
    log.warn("recipe failed validation, disabling", { key: recipe.key, problem });
    await query("UPDATE recipes SET status = 'disabled' WHERE key = $1", [recipe.key]);
    return null;
  }
  const results: Extract<ToolResult, { ok: true }>[] = [];
  let usd = 0;
  for (const step of recipe.steps) {
    const tool = tools.get(step.tool);
    const res: ToolResult = tool ? await runTool(tool, fill(step.params, vars), { runId }) : { ok: false, error: `unknown tool ${step.tool}`, usd: 0 };
    usd += res.usd;
    if (!res.ok) {
      log.warn("recipe step failed", { key: recipe.key, tool: step.tool, error: res.error });
      // Budget, missing keys and blocked URLs say nothing about whether the recipe works.
      if (!NEUTRAL_ERROR.test(res.error)) await recordReplay(recipe.key, false, usd);
      return null;
    }
    results.push(res);
  }
  const last = results.at(-1);
  if (last && Array.isArray(last.raw) && last.raw.length === 0) return results; // an empty page is not a broken recipe
  if (!last || !shapeMatches(recipe.expectedShape, last.raw)) {
    log.warn("recipe output drifted", { key: recipe.key });
    await recordReplay(recipe.key, false, usd);
    return null;
  }
  await recordReplay(recipe.key, true, usd);
  return results;
}
