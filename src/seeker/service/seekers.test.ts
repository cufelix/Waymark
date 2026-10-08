import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../core/errors.ts";
import { MemoryStore } from "../store/memory.ts";
import { createSeeker, getProfile, loadSeeker, putLinks, setPreferences } from "./seekers.ts";
import type { CareerPreferences, Consent } from "../contracts.ts";

const consent: Consent = { dataProcessing: true, nameSearch: false, givenAt: "2026-10-08T21:00:00Z", policyVersion: "2026-10-01" };
const prefs = (): CareerPreferences => ({
  targetOccupations: [{ uri: "urn:stub:occupation:nurse", label: "nurse", lang: "en" }],
  locations: [{ country: "CZ", city: "Brno" }],
  remote: "no",
  goal: "stability",
  dreamCompanies: [],
  dealBreakers: [],
  languages: [],
});
const code = (c: string) => (e: unknown) => e instanceof ApiError && e.code === c;

test("createSeeker mints skr_ id, version 1, incomplete", async () => {
  const deps = { store: new MemoryStore() };
  const { seekerId } = await createSeeker(deps, consent);
  assert.match(seekerId, /^skr_[0-9A-HJKMNP-TV-Z]{26}$/);
  const p = await getProfile(deps, seekerId);
  assert.equal(p.profileVersion, 1);
  assert.equal(p.status, "incomplete");
  assert.deepEqual(p.consent, consent);
  assert.deepEqual(p.links, []);
});

test("createSeeker without consent is consent_required", async () => {
  const deps = { store: new MemoryStore() };
  await assert.rejects(createSeeker(deps, { ...consent, dataProcessing: false } as any), code("consent_required"));
  await assert.rejects(createSeeker(deps, undefined as any), code("consent_required"));
  assert.equal(deps.store.records.size, 0);
});

test("setPreferences makes the profile complete; same body again keeps the version", async () => {
  const deps = { store: new MemoryStore() };
  const { seekerId } = await createSeeker(deps, consent);
  assert.deepEqual(await setPreferences(deps, seekerId, prefs()), prefs());
  const p = await getProfile(deps, seekerId);
  assert.equal(p.status, "complete");
  assert.equal(p.profileVersion, 2);
  await setPreferences(deps, seekerId, prefs());
  assert.equal((await getProfile(deps, seekerId)).profileVersion, 2);
  await setPreferences(deps, seekerId, { ...prefs(), goal: "mission" });
  assert.equal((await getProfile(deps, seekerId)).profileVersion, 3);
});

test("setPreferences rejects occupations without uri", async () => {
  const deps = { store: new MemoryStore() };
  const { seekerId } = await createSeeker(deps, consent);
  await assert.rejects(setPreferences(deps, seekerId, { ...prefs(), targetOccupations: [] }), code("unprocessable"));
  await assert.rejects(setPreferences(deps, seekerId, { ...prefs(), targetOccupations: [{ uri: "", label: "x", lang: "en" }] }), code("unprocessable"));
});

test("putLinks keeps id and addedAt for unchanged url+kind, mints new ones, drops removed", async () => {
  const deps = { store: new MemoryStore() };
  const { seekerId } = await createSeeker(deps, consent);
  const a = { url: "https://a.example.com", kind: "portfolio" as const };
  const b = { url: "https://github.example.com/b", kind: "github" as const };
  const first = await putLinks(deps, seekerId, [a, b]);
  assert.equal(first.length, 2);
  assert.ok(first.every((l) => /^lnk_/.test(l.id)));
  const v = (await getProfile(deps, seekerId)).profileVersion;

  const same = await putLinks(deps, seekerId, [a, b]);
  assert.deepEqual(same, first);
  assert.equal((await getProfile(deps, seekerId)).profileVersion, v, "unchanged list is not a change");

  const c = { url: "https://a.example.com", kind: "publication" as const }; // same url, other kind = new link
  const next = await putLinks(deps, seekerId, [b, c]);
  assert.deepEqual(next[0], first[1]);
  assert.notEqual(next[1].id, first[0].id);
  assert.equal((await getProfile(deps, seekerId)).profileVersion, v + 1);
  assert.deepEqual(await putLinks(deps, seekerId, []), []);
});

test("unknown and deletion-pending seekers are not_found for reads and writes", async () => {
  const deps = { store: new MemoryStore() };
  await assert.rejects(getProfile(deps, "skr_01M4EPBGAC0000000000000000"), code("not_found"));
  const { seekerId } = await createSeeker(deps, consent);
  await deps.store.update(seekerId, (r) => ({ ...r, deletionPending: true }));
  await assert.rejects(getProfile(deps, seekerId), code("not_found"));
  await assert.rejects(loadSeeker(deps, seekerId), code("not_found"));
  await assert.rejects(setPreferences(deps, seekerId, prefs()), code("not_found"));
  await assert.rejects(putLinks(deps, seekerId, []), code("not_found"));
});

test("one seeker's changes never show up on another", async () => {
  const deps = { store: new MemoryStore() };
  const a = (await createSeeker(deps, consent)).seekerId;
  const b = (await createSeeker(deps, consent)).seekerId;
  await setPreferences(deps, a, prefs());
  await putLinks(deps, a, [{ url: "https://a.example.com", kind: "portfolio" }]);
  const pb = await getProfile(deps, b);
  assert.equal(pb.seekerId, b);
  assert.equal(pb.status, "incomplete");
  assert.deepEqual(pb.links, []);
  assert.equal((await getProfile(deps, a)).seekerId, a);
});
