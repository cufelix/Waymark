import { isDeepStrictEqual } from "node:util";
import type { CareerPreferences, Consent, SeekerLink, SeekerLinkInput, SeekerProfile } from "../contracts.ts";
import { now } from "../core/claims.ts";
import { ApiError } from "../core/errors.ts";
import { newId } from "../core/ids.ts";
import { emptyPreferences, touch } from "../core/profile.ts";
import type { SeekerRecord, SeekerStore } from "../store/store.ts";

export type SeekerDeps = { store: SeekerStore };

const notFound = (seekerId: string): ApiError => new ApiError("not_found", `Seeker ${seekerId} does not exist`);

// A seeker marked deletion-pending is gone for every read and write except export and delete.
export async function loadSeeker(deps: SeekerDeps, seekerId: string): Promise<SeekerRecord> {
  const r = await deps.store.get(seekerId);
  if (!r || r.deletionPending) throw notFound(seekerId);
  return r;
}

// store.update under the per-seeker lock, refusing deletion-pending seekers inside the lock.
export function updateSeeker(deps: SeekerDeps, seekerId: string, fn: (r: SeekerRecord) => SeekerRecord): Promise<SeekerRecord> {
  return deps.store.update(seekerId, (r) => {
    if (r.deletionPending) throw notFound(seekerId);
    return fn(r);
  });
}

// POST /v1/seekers. Consent is required here (API.md).
export async function createSeeker(deps: SeekerDeps, consent: Consent): Promise<{ seekerId: string }> {
  if (consent?.dataProcessing !== true) throw new ApiError("consent_required", "consent.dataProcessing must be true");
  const seekerId = newId("skr");
  const profile = touch({
    seekerId,
    profileVersion: 0,
    status: "incomplete",
    consent,
    preferences: emptyPreferences(),
    statedSkills: [],
    documents: [],
    links: [],
    updatedAt: now(),
  });
  await deps.store.create({ profile, interview: [], draft: {}, cvTexts: {} });
  return { seekerId };
}

// PUT /v1/seekers/{id}/preferences. The body is already validated as complete preferences.
// Re-sending the same preferences is not a change, so the version stays.
export async function setPreferences(deps: SeekerDeps, seekerId: string, preferences: CareerPreferences): Promise<CareerPreferences> {
  if (preferences.targetOccupations.length === 0 || preferences.targetOccupations.some((o) => !o.uri)) {
    throw new ApiError("unprocessable", "targetOccupations: at least one occupation with a uri is required");
  }
  const r = await updateSeeker(deps, seekerId, (rec) =>
    isDeepStrictEqual(rec.profile.preferences, preferences) ? rec : { ...rec, profile: touch({ ...rec.profile, preferences }) },
  );
  return r.profile.preferences;
}

// PUT /v1/seekers/{id}/links: replace the list. A link with the same url and kind as before
// keeps its id and addedAt; new ones get a fresh lnk_ id. Part 1 only stores links.
export async function putLinks(deps: SeekerDeps, seekerId: string, links: SeekerLinkInput[]): Promise<SeekerLink[]> {
  const r = await updateSeeker(deps, seekerId, (rec) => {
    const at = now();
    const next: SeekerLink[] = links.map((l) => {
      const prev = rec.profile.links.find((x) => x.url === l.url && x.kind === l.kind);
      return prev ? { ...prev } : { ...l, id: newId("lnk"), addedAt: at };
    });
    return isDeepStrictEqual(rec.profile.links, next) ? rec : { ...rec, profile: touch({ ...rec.profile, links: next }) };
  });
  return r.profile.links;
}

// GET /v1/seekers/{id}/profile: the handoff object for Part 2.
export async function getProfile(deps: SeekerDeps, seekerId: string): Promise<SeekerProfile> {
  return (await loadSeeker(deps, seekerId)).profile;
}
