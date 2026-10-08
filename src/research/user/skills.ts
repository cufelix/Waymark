// Skill extraction from one artifact. The model proposes; code keeps only quotes that really exist in the artifact.
import { z } from "zod";
import { config } from "../../config";
import type { Claim, SeekerProfile } from "../../contracts";
import { newId } from "../../ids";
import { chatJson } from "../../llm";
import { resolveSkill } from "../../shared/taxonomy";
import type { Artifact } from "./artifact";
import type { Ownership } from "./ownership";

const MAX_SKILLS = 25;

const Extracted = z.object({
  skills: z.array(z.object({ label: z.string().min(1), quote: z.string().min(3), statement: z.string().min(1) })).default([]),
});

const squash = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Keeps only skills whose quote appears verbatim (whitespace and case normalised) in the artifact text. */
export function keepVerbatim<T extends { quote: string }>(skills: T[], text: string): T[] {
  const hay = squash(text);
  return skills.filter((s) => hay.includes(squash(s.quote)));
}

const SYSTEM = `You read content a job seeker made or published (a profile, repositories, posts, tracks, a portfolio page) and list the professional skills the content itself shows.
Rules:
- Only skills shown by the work itself, not wishes or self-praise.
- quote: copy an exact passage (5–200 characters) from the content that shows the skill. Copy it character for character.
- label: a short standard skill name (e.g. "Python", "audio mixing", "video editing", "technical writing").
- statement: one plain sentence, e.g. "Has public repositories written in Rust".
- At most ${MAX_SKILLS} skills. Return {"skills": []} if the content shows none.`;

export async function extractSkills(
  artifact: Artifact,
  profile: SeekerProfile,
  ownership: Ownership,
  runId?: string,
): Promise<Claim[]> {
  if (!artifact.source || artifact.text.trim().length < 20) return [];
  const targets = profile.preferences.targetOccupations.map((o) => o.label).join(", ") || "not given";
  const { value } = await chatJson(
    Extracted,
    SYSTEM,
    `Seeker's target occupations: ${targets}\nPlatform: ${artifact.platform}\nURL: ${artifact.url}\n\nContent:\n${artifact.text}`,
    { model: config.LLM_FAST_MODEL, runId, maxTokens: 3000 },
  );
  const kept = keepVerbatim(value.skills, artifact.text).slice(0, MAX_SKILLS);
  const lang = profile.preferences.languages[0]?.lang ?? "en";
  const source = artifact.source;
  return Promise.all(
    kept.map(async (s): Promise<Claim> => ({
      id: newId("clm"),
      subject: { kind: "seeker", id: profile.seekerId },
      statement: s.statement,
      skill: await resolveSkill(s.label, lang),
      kind: "fact",
      tier: ownership === "confirmed" ? "single-source" : "stated",
      sources: [{ ...source, id: newId("src"), quote: s.quote }],
    })),
  );
}
