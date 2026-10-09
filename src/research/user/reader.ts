// Reads one seeker link: replay a learned recipe, or let the agent work out how, then learn the recipe.
import { z } from "zod";
import { runAgent } from "../../agent/loop";
import { getRecipe, replay, saveRecipe, shapeOf, stepsFromCalls } from "../../agent/recipes";
import { config } from "../../config";
import type { SeekerLink } from "../../contracts";
import { errorMessage, log } from "../../log";
import { readerTools, toolRegistry } from "../../tools";
import { runTool } from "../../tools/types";
import { buildArtifact, type Artifact, type ArtifactStatus, type Step } from "./artifact";
import { inputKey, platformOf, varsFor } from "./key";

export type ReadResult = { artifact: Artifact; status: ArtifactStatus; reason?: string; usd: number; learned: boolean };

export const READER_SYSTEM = `You read one public web link that a job seeker gave us as evidence of their work, and find the tool calls that return that person's actual content.

Rules:
- Public content only. Never log in, never use cookies, never try to get past captchas or paywalls.
- Prefer free official APIs first (github_api for GitHub, e.g. path "/users/{name}" then "/users/{name}/repos?sort=pushed&per_page=30").
- For ordinary websites, blogs, portfolios and online PDFs use fetch_url first; use firecrawl_scrape only if fetch_url returns little text (JavaScript-heavy pages).
- firecrawl refuses social and media platforms (Instagram, TikTok, YouTube, X, Facebook, LinkedIn). For those, and for platforms like SoundCloud, Behance, Dribbble, Twitch, Bandcamp: call apify_store_search with the platform name plus "profile scraper", choose an actor marked eligible with the most users that takes a profile URL or username, then call apify_run_actor with that actor, the seeker's URL or handle in the input, and maxItems of 30 or less. Read the actor description to build the input object.
- exa_contents is a last-resort reader for a page the other tools could not read.
- Keep it short: you have very few tool calls. Do not repeat a failing call with the same input.
- Choose the calls whose output really contains this person's own content (profile, projects, posts, tracks, repos, writing), not search results about other people.

When done, call finish with:
- usedCalls: the call numbers (#) whose outputs together hold the content, in the order they must be re-run,
- status: "extracted" if you got the content, "partial" if only part of it, "unsupported" if no allowed tool can read it,
- reason: one short sentence (required unless extracted).`;

const Finish = z.object({
  usedCalls: z.array(z.number().int().nonnegative()).default([]),
  status: z.enum(["extracted", "partial", "unsupported"]),
  reason: z.string().optional(),
});

const finishSpec = {
  description: "Finish reading this link.",
  parameters: {
    type: "object",
    properties: {
      usedCalls: { type: "array", items: { type: "integer" }, description: "Call numbers whose outputs hold the content, in re-run order" },
      status: { type: "string", enum: ["extracted", "partial", "unsupported"] },
      reason: { type: "string" },
    },
    required: ["usedCalls", "status"],
  },
  parse: (a: unknown) => Finish.parse(a),
};

export async function readInput(link: SeekerLink, runId?: string): Promise<ReadResult> {
  const key = inputKey(link.url);
  const vars = varsFor(link.url);
  const input = { inputId: link.id, url: link.url, platform: platformOf(link.url) };

  const recipe = await getRecipe(key);
  if (recipe) {
    const results = await replay(recipe, vars, toolRegistry, runId);
    if (results) {
      const steps: Step[] = recipe.steps.map((s, i) => ({ tool: s.tool, result: results[i]! }));
      const artifact = await buildArtifact(input, steps, { status: "extracted" });
      return { artifact, status: "extracted", usd: results.reduce((s, r) => s + r.usd, 0), learned: false };
    }
  }

  try {
    const run = await runAgent({
      system: READER_SYSTEM,
      task: `Link: ${link.url}\nPlatform guess: ${input.platform}\nHandle guess: ${vars.handle ?? "none"}`,
      tools: readerTools,
      finish: finishSpec,
      maxSteps: config.AGENT_MAX_STEPS,
      maxUsd: config.AGENT_MAX_USD,
      model: config.LLM_AGENT_MODEL,
      runId,
    });
    const used = (run.finished?.usedCalls ?? []).map((i) => run.calls[i]).filter((c) => c?.result.ok);
    const steps: Step[] = used.map((c) => ({ tool: c!.tool, result: c!.result as Step["result"] }));
    if (run.finished && run.finished.status !== "unsupported" && steps.length > 0) {
      await saveRecipe({
        key,
        steps: stepsFromCalls(run.calls, run.finished.usedCalls, vars),
        expectedShape: shapeOf(steps.at(-1)!.result.raw),
        usdPerRun: steps.reduce((s, x) => s + x.result.usd, 0),
      });
      const artifact = await buildArtifact(input, steps, { status: run.finished.status, reason: run.finished.reason });
      return { artifact, status: artifact.status, reason: artifact.reason, usd: run.usd, learned: true };
    }
    const status: ArtifactStatus = run.finished?.status === "unsupported" ? "unsupported" : "failed";
    const reason = run.finished?.reason ?? `agent stopped: ${run.stopReason}`;
    const artifact = await buildArtifact(input, [], { status, reason });
    return { artifact, status: artifact.status, reason: artifact.reason, usd: run.usd, learned: false };
  } catch (err) {
    // The model is unavailable (no key, cap reached, outage): fall back to a plain fetch so the seeker still gets something.
    log.warn("reader agent failed, falling back to fetch_url", { url: link.url, error: errorMessage(err) });
    const fetchTool = toolRegistry.get("fetch_url");
    const res = fetchTool ? await runTool(fetchTool, { url: link.url }, { runId }) : null;
    const steps: Step[] = res?.ok && res.text.trim().length > 0 ? [{ tool: "fetch_url", result: res }] : [];
    const artifact = await buildArtifact(input, steps, { status: "partial", reason: `read without the agent: ${errorMessage(err)}` });
    return { artifact, status: artifact.status, reason: artifact.reason, usd: res?.usd ?? 0, learned: false };
  }
}
