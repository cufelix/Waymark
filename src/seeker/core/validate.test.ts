import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ApiError } from "./errors.ts";
import {
  country,
  currency,
  httpUrl,
  isoDate,
  lang,
  validateConsent,
  validateCreateSeeker,
  validateInterviewMessage,
  validateLinks,
  validatePreferences,
  validateSeekerProfile,
} from "./validate.ts";

const rejects = (fn: () => unknown, code: string, path?: RegExp) =>
  assert.throws(fn, (e: unknown) => e instanceof ApiError && e.code === code && (!path || path.test(e.message)));

const consent = { dataProcessing: true, nameSearch: false, givenAt: "2026-10-08T21:00:00Z", policyVersion: "2026-10-01" };

export const validPreferences = () => ({
  targetOccupations: [{ uri: "urn:stub:occupation:nurse", label: "nurse", lang: "en" }],
  locations: [{ country: "CZ", city: "Brno" }],
  remote: "no",
  goal: "stability",
  dreamCompanies: [{ name: "Example Hospital", url: "https://example.com" }],
  dealBreakers: [],
  languages: [{ lang: "cs", level: "native" }],
  salaryExpectation: { min: 40000, currency: "CZK", period: "month" },
});

test("consent: valid, missing, false, malformed, unknown field", () => {
  assert.deepEqual(validateCreateSeeker({ consent }), { consent });
  rejects(() => validateCreateSeeker({}), "consent_required");
  rejects(() => validateCreateSeeker(undefined), "consent_required");
  rejects(() => validateConsent({ ...consent, dataProcessing: false }), "consent_required");
  rejects(() => validateConsent({ nameSearch: false, givenAt: consent.givenAt, policyVersion: "1" }), "consent_required");
  rejects(() => validateConsent({ ...consent, dataProcessing: "yes" }), "unprocessable", /consent\.dataProcessing/);
  rejects(() => validateConsent({ ...consent, nameSearch: undefined }), "unprocessable", /consent\.nameSearch: is required/);
  rejects(() => validateConsent({ ...consent, givenAt: "yesterday" }), "unprocessable", /consent\.givenAt/);
  rejects(() => validateConsent({ ...consent, extra: 1 }), "unprocessable", /consent\.extra: unknown field/);
  rejects(() => validateCreateSeeker({ consent, seekerId: "skr_x" }), "unprocessable", /^seekerId: unknown field/);
});

test("preferences: complete body passes, nested unknown field is named", () => {
  assert.deepEqual(validatePreferences(validPreferences()), validPreferences());
  const p: any = validPreferences();
  p.locations[0].zip = "60200";
  rejects(() => validatePreferences(p), "unprocessable", /^locations\[0\]\.zip: unknown field/);
});

test("preferences: must be complete, with occupation uris", () => {
  const p: any = validPreferences();
  delete p.goal;
  rejects(() => validatePreferences(p), "unprocessable", /^goal: is required/);
  rejects(() => validatePreferences({ ...validPreferences(), targetOccupations: [] }), "unprocessable", /targetOccupations: must have at least 1/);
  rejects(
    () => validatePreferences({ ...validPreferences(), targetOccupations: [{ label: "nurse", lang: "en" }] }),
    "unprocessable",
    /targetOccupations\[0\]\.uri: is required/,
  );
  rejects(
    () => validatePreferences({ ...validPreferences(), targetOccupations: [{ uri: "nurse", label: "nurse", lang: "en" }] }),
    "unprocessable",
    /targetOccupations\[0\]\.uri: must be an ESCO URI/,
  );
});

test("preferences: enums, country, currency, language, salary", () => {
  rejects(() => validatePreferences({ ...validPreferences(), remote: "sometimes" }), "unprocessable", /^remote: must be one of/);
  rejects(() => validatePreferences({ ...validPreferences(), goal: "money" }), "unprocessable", /^goal/);
  rejects(() => validatePreferences({ ...validPreferences(), locations: [{ country: "cz" }] }), "unprocessable", /locations\[0\]\.country/);
  rejects(() => validatePreferences({ ...validPreferences(), languages: [{ lang: "cs", level: "expert" }] }), "unprocessable", /languages\[0\]\.level/);
  rejects(
    () => validatePreferences({ ...validPreferences(), salaryExpectation: { min: -1, currency: "CZK", period: "month" } }),
    "unprocessable",
    /salaryExpectation\.min/,
  );
  rejects(
    () => validatePreferences({ ...validPreferences(), salaryExpectation: { min: 1, currency: "KCS", period: "month" } }),
    "unprocessable",
    /salaryExpectation\.currency/,
  );
  rejects(() => validatePreferences({ ...validPreferences(), dreamCompanies: [{ name: "X", url: "ftp://x.example.com" }] }), "unprocessable", /dreamCompanies\[0\]\.url/);
});

test("standards", () => {
  assert.equal(country("CZ", "c"), "CZ");
  for (const bad of ["UK", "EU", "XX", "cz", "CZE", 1]) rejects(() => country(bad, "c"), "unprocessable");
  assert.equal(lang("en-GB", "l"), "en-GB");
  for (const bad of ["en_GB", "EN", "x", "", 3]) rejects(() => lang(bad, "l"), "unprocessable");
  assert.equal(currency("EUR", "c"), "EUR");
  for (const bad of ["eur", "XYZ", "EURO"]) rejects(() => currency(bad, "c"), "unprocessable");
  assert.equal(isoDate("2026-10-08T21:00:00.123Z", "d"), "2026-10-08T21:00:00.123Z");
  for (const bad of ["2026-10-08", "2026-13-01T00:00:00Z", "2026-02-30T00:00:00Z", "2026-10-08T21:00:00+02:00"]) rejects(() => isoDate(bad, "d"), "unprocessable");
  assert.equal(httpUrl("https://example.com/a", "u"), "https://example.com/a");
  for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "example.com", "https://user:pw@example.com"]) rejects(() => httpUrl(bad, "u"), "unprocessable");
});

test("links: valid list, bad kind, bad url, duplicates, unknown field", () => {
  const links = [
    { url: "https://github.example.com/a", kind: "github" },
    { url: "https://a.example.com", kind: "portfolio" },
  ];
  assert.deepEqual(validateLinks({ links }), links);
  assert.deepEqual(validateLinks({ links: [{ url: "https://unknown.example.com" }] }), [{ url: "https://unknown.example.com" }]);
  assert.deepEqual(validateLinks({ links: [links[1], { ...links[1], kind: "publication" }] }), [
    links[1],
    { ...links[1], kind: "publication" },
  ]);
  assert.deepEqual(validateLinks({ links: [] }), []);
  rejects(() => validateLinks({ links: [{ url: "https://a.example.com", kind: "blog" }] }), "unprocessable", /links\[0\]\.kind/);
  rejects(() => validateLinks({ links: [{ url: "mailto:a@example.com", kind: "other" }] }), "unprocessable", /links\[0\]\.url/);
  rejects(() => validateLinks({ links: [links[0], links[0]] }), "unprocessable", /links\[1\]: duplicate of links\[0\]/);
  rejects(
    () => validateLinks({ links: [{ url: links[0].url }, links[0]] }),
    "unprocessable",
    /links\[1\]: duplicate of links\[0\]/,
  );
  rejects(
    () => validateLinks({ links: [links[0], { url: links[0].url }] }),
    "unprocessable",
    /links\[1\]: duplicate of links\[0\]/,
  );
  rejects(() => validateLinks({ links: [{ ...links[0], id: "lnk_x" }] }), "unprocessable", /links\[0\]\.id: unknown field/);
  rejects(() => validateLinks(links), "unprocessable", /body: must be an object/);
});

test("interview message: empty text allowed, exact shape and 4000-character limit enforced", () => {
  assert.deepEqual(validateInterviewMessage({ text: "" }), { text: "" });
  assert.equal(validateInterviewMessage({ text: "x".repeat(4000) }).text.length, 4000);
  rejects(() => validateInterviewMessage({ text: "hi", role: "agent" }), "unprocessable", /role: unknown field/);
  rejects(() => validateInterviewMessage({ text: 1 }), "unprocessable", /^text/);
  rejects(() => validateInterviewMessage({ text: "x".repeat(4001) }), "unprocessable", /at most 4000 characters/);
});

const FIXTURES = join(import.meta.dirname, "../../../fixtures/profiles");

test("every fixture in fixtures/profiles validates as SeekerProfile", () => {
  const files = readdirSync(FIXTURES).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 3, "expected at least 3 fixtures");
  const ids = new Set<string>();
  for (const f of files) {
    const raw = JSON.parse(readFileSync(join(FIXTURES, f), "utf8"));
    const p = validateSeekerProfile(raw);
    assert.deepEqual(p, raw, `${f}: validated profile differs from the file`);
    assert.equal(p.status, "complete", `${f}: fixtures are complete handoff profiles`);
    assert.ok(p.statedSkills.every((c) => c.tier === "stated"), `${f}: only stated skills`);
    assert.ok(!ids.has(p.seekerId), `${f}: duplicate seekerId`);
    ids.add(p.seekerId);
    const text = JSON.stringify(raw);
    for (const url of text.match(/https?:\/\/[^"]+/g) ?? []) assert.match(new URL(url).hostname, /(^|\.)example\.com$/, `${f}: ${url} is not example.com`);
    assert.doesNotMatch(text, /data\.europa\.eu/, `${f}: no invented ESCO URIs, use urn:stub:`);
  }
});

test("profile validator rejects proven tiers, foreign subjects and wrong status", () => {
  const raw = JSON.parse(readFileSync(join(FIXTURES, readdirSync(FIXTURES).filter((f) => f.endsWith(".json"))[0]), "utf8"));
  const tier = structuredClone(raw);
  tier.statedSkills[0].tier = "verified";
  rejects(() => validateSeekerProfile(tier), "unprocessable", /statedSkills\[0\]\.tier/);
  const subject = structuredClone(raw);
  subject.statedSkills[0].subject.id = "skr_01M4EPBGAC0000000000000000";
  rejects(() => validateSeekerProfile(subject), "unprocessable", /statedSkills\[0\]\.subject/);
  const status = structuredClone(raw);
  status.preferences.targetOccupations = [];
  rejects(() => validateSeekerProfile(status), "unprocessable", /^status: must be "incomplete"/);
  const extra = structuredClone(raw);
  extra.score = 87;
  rejects(() => validateSeekerProfile(extra), "unprocessable", /^score: unknown field/);
});

test("profile validator accepts every document kind and links without a kind", () => {
  const raw = JSON.parse(readFileSync(join(FIXTURES, "junior-backend-prague.json"), "utf8"));
  for (const kind of ["cv", "certificate", "portfolio", "image", "other"]) {
    const profile = structuredClone(raw);
    profile.documents[0].kind = kind;
    assert.equal(validateSeekerProfile(profile).documents[0].kind, kind);
  }
  const untypedLink = structuredClone(raw);
  delete untypedLink.links[0].kind;
  assert.equal("kind" in validateSeekerProfile(untypedLink).links[0], false);

  const invalid = structuredClone(raw);
  invalid.documents[0].kind = "transcript";
  rejects(() => validateSeekerProfile(invalid), "unprocessable", /documents\[0\]\.kind/);
});
