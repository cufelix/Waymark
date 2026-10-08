// Opt-in "this may be you" search. Never stores claims; only returns candidates for the seeker to confirm.
import type { ResearchOptions, SeekerProfile, SeekerResearch } from "../../contracts";
import { toolRegistry } from "../../tools";
import { runTool } from "../../tools/types";

type Candidates = NonNullable<SeekerResearch["nameSearch"]>;

export async function nameSearch(
  profile: SeekerProfile,
  options: ResearchOptions,
  name: string | undefined,
  runId?: string,
): Promise<Candidates | undefined> {
  if (!profile.consent.nameSearch || !options.nameSearch) return undefined;
  // SeekerProfile has no name field (API.md); without a name there is nothing to search for.
  if (!name?.trim()) return undefined;
  const exa = toolRegistry.get("exa_search");
  if (!exa) return undefined;
  const res = await runTool(exa, { query: name.trim(), category: "people", numResults: 10 }, { runId });
  if (!res.ok || !Array.isArray(res.raw)) return { candidates: [] };
  return {
    candidates: (res.raw as { url?: string; title?: string; text?: string }[])
      .filter((r) => r.url)
      .map((r) => ({ url: r.url!, title: r.title ?? r.url!, snippet: (r.text ?? "").slice(0, 280) })),
  };
}
