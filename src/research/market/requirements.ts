// Requirement extraction: the fast model reads job descriptions; only quotes that really appear in the ad survive.
import { z } from "zod";
import type { Skill, Source } from "../../contracts";
import { query } from "../../db/pool";
import { newId } from "../../ids";
import { chatJson } from "../../llm";
import { log, errorMessage } from "../../log";
import { resolveSkill } from "../../shared/taxonomy";
import { quoteInText } from "./normalise";

const BATCH = 5;
const MAX_DESCRIPTION = 6000;

const Extracted = z.object({
  vacancies: z.array(
    z.object({
      id: z.string(),
      requirements: z.array(z.object({ label: z.string().min(1), required: z.boolean(), quote: z.string().min(1) })),
    }),
  ),
});

export type ProposedRequirement = { label: string; required: boolean; quote: string };

/** Keeps requirements whose quote is in the description, one per label. */
export function filterVerbatim(proposed: ProposedRequirement[], description: string): ProposedRequirement[] {
  const seen = new Set<string>();
  return proposed.filter((r) => {
    const key = r.label.toLowerCase().trim();
    if (seen.has(key) || !quoteInText(r.quote, description)) return false;
    seen.add(key);
    return true;
  });
}

type Row = {
  id: string;
  data: { title: string; description?: string; sourceUrl?: string; sourceTool?: Source["tool"]; snapshotKey?: string; snapshotHash?: string };
};

/** Extracts requirements for the run's vacancies that don't have them yet. Failures leave a vacancy without requirements. */
export async function extractRequirements(runId: string, onBatch?: (done: number, total: number) => void): Promise<void> {
  const rows = await query<Row>(
    `SELECT v.id, v.data FROM vacancies v JOIN run_vacancies rv ON rv.vacancy_id = v.id
     WHERE rv.run_id = $1 AND coalesce((v.data->>'requirementsExtracted')::boolean, false) = false
       AND length(coalesce(v.data->>'description', '')) > 40`,
    [runId],
  );
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    try {
      await extractBatch(batch, runId);
    } catch (err) {
      log.warn("requirement extraction failed", { runId, error: errorMessage(err) });
    }
    onBatch?.(Math.min(i + BATCH, rows.length), rows.length);
  }
}

async function extractBatch(batch: Row[], runId: string): Promise<void> {
  const input = batch.map((r) => ({ id: r.id, title: r.data.title, description: (r.data.description ?? "").slice(0, MAX_DESCRIPTION) }));
  const { value } = await chatJson(
    Extracted,
    "You read job ads in any language and list what each ad requires from a candidate: skills, tools, certifications, licences, languages, experience. " +
      "For each requirement give a short skill label in English, whether the ad says it is required (true) or only nice to have (false), " +
      "and the exact sentence fragment from the ad that states it, copied character for character in the ad's language.",
    `Ads:\n${JSON.stringify(input)}\nReturn {"vacancies":[{"id":"…","requirements":[{"label":"…","required":true,"quote":"…"}]}]}`,
    { runId, maxTokens: 6000 },
  );
  const byId = new Map(value.vacancies.map((v) => [v.id, v.requirements]));
  for (const row of batch) {
    const description = row.data.description ?? "";
    const kept = filterVerbatim(byId.get(row.id) ?? [], description);
    const requirements: { skill: Skill; required: boolean; source: Source }[] = [];
    for (const r of kept) {
      const skill = await resolveSkill(r.label, "en");
      if (requirements.some((x) => x.skill.uri === skill.uri)) continue;
      requirements.push({
        skill,
        required: r.required,
        source: {
          id: newId("src"),
          url: row.data.sourceUrl ?? "",
          title: row.data.title,
          fetchedAt: new Date().toISOString(),
          tool: row.data.sourceTool ?? "apify",
          quote: r.quote,
          contentHash: row.data.snapshotHash ?? "",
          snapshotKey: row.data.snapshotKey,
        },
      });
    }
    await query(
      `UPDATE vacancies SET data = data || jsonb_build_object('requirements', $2::jsonb, 'requirementsExtracted', true) WHERE id = $1`,
      [row.id, JSON.stringify(requirements)],
    );
  }
}
