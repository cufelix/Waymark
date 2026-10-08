import type { CareerPreferences, Claim, SeekerProfile } from "../contracts.ts";
import { now } from "./claims.ts";

// CareerPreferences has required fields, so a fresh seeker gets neutral placeholders.
// Status stays "incomplete" until targetOccupations has at least one entry.
export function emptyPreferences(): CareerPreferences {
  return { targetOccupations: [], locations: [], remote: "ok", goal: "learn-fast", dreamCompanies: [], dealBreakers: [], languages: [] };
}

// API.md: status is "complete" once preferences have at least one target occupation and consent is given.
export function computeStatus(p: SeekerProfile): SeekerProfile["status"] {
  return p.consent?.dataProcessing === true && p.preferences.targetOccupations.length >= 1 ? "complete" : "incomplete";
}

// Call after every change to a profile: profileVersion +1, updatedAt, status.
export function touch(p: SeekerProfile): SeekerProfile {
  const next = { ...p, profileVersion: p.profileVersion + 1, updatedAt: now() };
  return { ...next, status: computeStatus(next) };
}

// Merge stated-skill claims by skill URI: one claim per skill, sources accumulated.
export function mergeStatedSkills(existing: Claim[], incoming: Claim[]): Claim[] {
  const out = existing.map((c) => ({ ...c, sources: [...c.sources] }));
  for (const c of incoming) {
    const same = out.find((e) => e.skill && c.skill && e.skill.uri === c.skill.uri);
    if (same) same.sources.push(...c.sources.filter((s) => !same.sources.some((x) => x.url === s.url && x.quote === s.quote)));
    else out.push({ ...c, sources: [...c.sources] });
  }
  return out;
}

// Drop every source with this URL prefix; a claim left without sources is removed.
export function removeSources(claims: Claim[], urlPrefix: string): Claim[] {
  return claims
    .map((c) => ({ ...c, sources: c.sources.filter((s) => !s.url.startsWith(urlPrefix)) }))
    .filter((c) => c.sources.length > 0);
}
