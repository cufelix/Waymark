import type { Occupation, Skill } from "./contracts.ts";

// Local stand-in for @cufelix's src/shared/taxonomy/ (ESCO wrapper). Same idea, a few
// hard-coded entries; swap the import when the real module lands.
// Stub URIs are urn:stub:… on purpose: never pass off a made-up ID as a real ESCO URI.
const OCCUPATIONS: Occupation[] = ["software developer", "web developer", "backend developer", "devops engineer", "nurse"].map(
  (label) => ({ uri: `urn:stub:occupation:${label.replace(/ /g, "-")}`, label, lang: "en" }),
);

export async function findOccupation(text: string): Promise<Occupation[]> {
  const q = text.toLowerCase();
  return OCCUPATIONS.filter((o) => o.label.includes(q) || q.includes(o.label.split(" ")[0]));
}

// Unknown skills get a provisional URI so parts still compare URIs, never prose.
export async function findSkill(text: string, lang = "en"): Promise<Skill> {
  const slug = text.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-");
  return { uri: `urn:stub:skill:${slug}`, label: text.trim(), lang };
}
