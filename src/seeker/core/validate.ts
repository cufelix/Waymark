import type {
  CareerChoice,
  CareerPreferences,
  Claim,
  Consent,
  Occupation,
  SeekerDocument,
  SeekerLink,
  SeekerLinkInput,
  SeekerProfile,
  Skill,
  Source,
} from "../contracts.ts";
import { ApiError } from "./errors.ts";
import { computeStatus } from "./profile.ts";

// Strict hand-written validators for request bodies (API.md "Validation": every body is
// checked against the types, unknown fields are rejected with `unprocessable`).
// Error messages name the field path, e.g. "preferences.locations[0].country: …".

// ---------- primitives ----------

type Obj = Record<string, unknown>;

function bad(path: string, message: string): never {
  throw new ApiError("unprocessable", `${path || "body"}: ${message}`);
}

const at = (path: string, key: string): string => (path ? `${path}.${key}` : key);

// Plain JSON object with only the allowed keys; returns it for field access.
function object(v: unknown, path: string, required: readonly string[], optional: readonly string[] = []): Obj {
  if (typeof v !== "object" || v === null || Array.isArray(v)) bad(path, "must be an object");
  const o = v as Obj;
  for (const k of Object.keys(o)) {
    if (!required.includes(k) && !optional.includes(k)) bad(at(path, k), "unknown field");
  }
  for (const k of required) if (o[k] === undefined) bad(at(path, k), "is required");
  return o;
}

function string(v: unknown, path: string, max = 200): string {
  if (typeof v !== "string") bad(path, "must be a string");
  if (v.trim() === "") bad(path, "must not be empty");
  if (v.length > max) bad(path, `must be at most ${max} characters`);
  return v;
}

function boolean(v: unknown, path: string): boolean {
  if (typeof v !== "boolean") bad(path, "must be a boolean");
  return v;
}

function integer(v: unknown, path: string, min: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min) bad(path, `must be an integer >= ${min}`);
  return v;
}

function oneOf<T extends string>(v: unknown, path: string, values: readonly T[]): T {
  if (typeof v !== "string" || !(values as readonly string[]).includes(v)) bad(path, `must be one of ${values.join(", ")}`);
  return v as T;
}

function array<T>(v: unknown, path: string, item: (x: unknown, p: string) => T, opts: { min?: number; max: number }): T[] {
  if (!Array.isArray(v)) bad(path, "must be an array");
  const min = opts.min ?? 0;
  if (v.length < min) bad(path, `must have at least ${min} item${min === 1 ? "" : "s"}`);
  if (v.length > opts.max) bad(path, `must have at most ${opts.max} items`);
  return v.map((x, i) => item(x, `${path}[${i}]`));
}

function optional<T>(o: Obj, key: string, path: string, fn: (x: unknown, p: string) => T): T | undefined {
  return o[key] === undefined ? undefined : fn(o[key], at(path, key));
}

// ---------- standards (API.md "Conventions") ----------

// ISO 8601 UTC, "2026-10-08T21:00:00Z" (milliseconds allowed), and a real calendar date.
export function isoDate(v: unknown, path: string): string {
  const s = string(v, path, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(s)) bad(path, "must be an ISO 8601 UTC timestamp like 2026-10-08T21:00:00Z");
  const d = new Date(s);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 19) !== s.slice(0, 19)) bad(path, "is not a real date");
  return s;
}

// ISO 3166-1 alpha-2, officially assigned codes only (no "UK", "EU", "XK").
const COUNTRIES = new Set(
  (
    "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
    "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
    "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
    "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT " +
    "MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
    "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG " +
    "UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
  ).split(" "),
);

export function country(v: unknown, path: string): string {
  if (typeof v !== "string" || !COUNTRIES.has(v)) bad(path, "must be an ISO 3166-1 alpha-2 country code like CZ");
  return v;
}

// BCP 47, well-formed and in canonical form ("cs", "en-GB"; not "EN" or "en_GB").
export function lang(v: unknown, path: string): string {
  if (typeof v !== "string") bad(path, "must be a BCP 47 language tag like cs");
  let canonical: string | undefined;
  try {
    canonical = Intl.getCanonicalLocales(v)[0];
  } catch {
    bad(path, "must be a BCP 47 language tag like cs");
  }
  if (canonical !== v) bad(path, `must be in canonical form (${canonical})`);
  return v;
}

const CURRENCIES = new Set(Intl.supportedValuesOf("currency"));

export function currency(v: unknown, path: string): string {
  if (typeof v !== "string" || !CURRENCIES.has(v)) bad(path, "must be an ISO 4217 currency code like EUR");
  return v;
}

export function httpUrl(v: unknown, path: string): string {
  const s = string(v, path, 2048);
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    bad(path, "must be a valid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") bad(path, "must be an http(s) URL");
  if (!u.hostname) bad(path, "must have a host");
  if (u.username || u.password) bad(path, "must not contain credentials");
  return s;
}

// ESCO URI, or the urn:stub:… IDs from taxonomy.ts until the real ESCO module lands.
function taxonomyUri(v: unknown, path: string): string {
  const s = string(v, path, 500);
  if (!/^https?:\/\/\S+$/.test(s) && !/^urn:stub:(occupation|skill):[a-z0-9-]+$/.test(s)) bad(path, "must be an ESCO URI");
  return s;
}

function prefixedId(v: unknown, path: string, prefix: string): string {
  if (typeof v !== "string" || !new RegExp(`^${prefix}_[0-9A-HJKMNP-TV-Z]{26}$`).test(v)) bad(path, `must be a ${prefix}_ id`);
  return v;
}

function runId(v: unknown, path: string): string {
  const id = string(v, path);
  if (!/^run_.+/.test(id)) bad(path, 'must start with "run_"');
  return id;
}

// ---------- Part 1 request bodies ----------

// POST /v1/seekers body. Missing consent or dataProcessing !== true is consent_required (403),
// a malformed consent is unprocessable (422).
export function validateCreateSeeker(body: unknown): { consent: Consent } {
  const o = object(body ?? {}, "", [], ["consent"]);
  if (o.consent === undefined) throw new ApiError("consent_required", "consent is required to create a seeker");
  return { consent: validateConsent(o.consent, "consent") };
}

export function validateConsent(v: unknown, path = "consent"): Consent {
  // Unknown fields first (422), then the consent itself (403), then the remaining fields (422).
  const keys = ["dataProcessing", "nameSearch", "givenAt", "policyVersion"];
  const o = object(v, path, [], keys);
  if (o.dataProcessing !== undefined && typeof o.dataProcessing !== "boolean") bad(at(path, "dataProcessing"), "must be a boolean");
  if (o.dataProcessing !== true) throw new ApiError("consent_required", `${at(path, "dataProcessing")}: must be true`);
  object(v, path, keys);
  return {
    dataProcessing: true,
    nameSearch: boolean(o.nameSearch, at(path, "nameSearch")),
    givenAt: isoDate(o.givenAt, at(path, "givenAt")),
    policyVersion: string(o.policyVersion, at(path, "policyVersion"), 50),
  };
}

function taxonomyEntry(v: unknown, path: string): Occupation | Skill {
  const o = object(v, path, ["uri", "label", "lang"]);
  return { uri: taxonomyUri(o.uri, at(path, "uri")), label: string(o.label, at(path, "label")), lang: lang(o.lang, at(path, "lang")) };
}

const LANGUAGE_LEVELS = ["basic", "working", "fluent", "native"] as const;

// PUT /v1/seekers/{id}/preferences: the full, complete CareerPreferences (at least one occupation).
export function validatePreferences(v: unknown, path = ""): CareerPreferences {
  const o = object(
    v,
    path,
    ["targetOccupations", "locations", "remote", "goal", "dreamCompanies", "dealBreakers", "languages"],
    ["salaryExpectation"],
  );
  const prefs: CareerPreferences = {
    targetOccupations: array(o.targetOccupations, at(path, "targetOccupations"), taxonomyEntry, { min: 1, max: 10 }),
    locations: array(
      o.locations,
      at(path, "locations"),
      (x, p) => {
        const l = object(x, p, ["country"], ["city"]);
        const city = optional(l, "city", p, (c, cp) => string(c, cp, 100));
        return { country: country(l.country, at(p, "country")), ...(city !== undefined ? { city } : {}) };
      },
      { max: 20 },
    ),
    remote: oneOf(o.remote, at(path, "remote"), ["only", "ok", "no"] as const),
    goal: oneOf(o.goal, at(path, "goal"), ["learn-fast", "stability", "mission"] as const),
    dreamCompanies: array(
      o.dreamCompanies,
      at(path, "dreamCompanies"),
      (x, p) => {
        const c = object(x, p, ["name"], ["url"]);
        const url = optional(c, "url", p, httpUrl);
        return { name: string(c.name, at(p, "name")), ...(url !== undefined ? { url } : {}) };
      },
      { max: 50 },
    ),
    dealBreakers: array(o.dealBreakers, at(path, "dealBreakers"), (x, p) => string(x, p, 500), { max: 50 }),
    languages: array(
      o.languages,
      at(path, "languages"),
      (x, p) => {
        const l = object(x, p, ["lang", "level"]);
        return { lang: lang(l.lang, at(p, "lang")), level: oneOf(l.level, at(p, "level"), LANGUAGE_LEVELS) };
      },
      { max: 20 },
    ),
  };
  const salary = optional(o, "salaryExpectation", path, (x, p) => {
    const s = object(x, p, ["min", "currency", "period"]);
    if (typeof s.min !== "number" || !Number.isFinite(s.min) || s.min < 0) bad(at(p, "min"), "must be a number >= 0");
    return { min: s.min, currency: currency(s.currency, at(p, "currency")), period: oneOf(s.period, at(p, "period"), ["month", "year"] as const) };
  });
  return salary ? { ...prefs, salaryExpectation: salary } : prefs;
}

const LINK_KINDS = ["portfolio", "github", "linkedin", "social", "certificate", "publication", "other"] as const;

function linkInput(v: unknown, path: string): SeekerLinkInput {
  const o = object(v, path, ["url", "kind"]);
  return { url: httpUrl(o.url, at(path, "url")), kind: oneOf(o.kind, at(path, "kind"), LINK_KINDS) };
}

// PUT /v1/seekers/{id}/links body: { links: SeekerLinkInput[] }. Duplicate url+kind is rejected.
export function validateLinks(body: unknown): SeekerLinkInput[] {
  const o = object(body, "", ["links"]);
  const links = array(o.links, "links", linkInput, { max: 50 });
  links.forEach((l, i) => {
    const first = links.findIndex((x) => x.url === l.url && x.kind === l.kind);
    if (first !== i) bad(`links[${i}]`, `duplicate of links[${first}]`);
  });
  return links;
}

// POST /v1/seekers/{id}/interview/messages body: { text }. Empty text asks for the first question.
export function validateInterviewMessage(body: unknown): { text: string } {
  const o = object(body, "", ["text"]);
  if (typeof o.text !== "string") bad("text", "must be a string");
  if (o.text.length > 5000) bad("text", "must be at most 5000 characters");
  return { text: o.text };
}

// PUT /v1/seekers/{id}/career-choice body: the run and one occupation URI it returned.
export function validateCareerChoice(body: unknown): { runId: string; occupationUri: string } {
  const o = object(body, "", ["runId", "occupationUri"]);
  return { runId: runId(o.runId, "runId"), occupationUri: string(o.occupationUri, "occupationUri", 500) };
}

// ---------- SeekerProfile (fixtures and the handoff object) ----------

function source(v: unknown, path: string, seekerId: string): Source {
  const o = object(v, path, ["id", "url", "title", "fetchedAt", "tool", "contentHash"], ["quote", "snapshotKey"]);
  const tool = oneOf(o.tool, at(path, "tool"), ["seeker-upload", "seeker-interview"] as const);
  const url = string(o.url, at(path, "url"), 500);
  const urlOk =
    tool === "seeker-upload"
      ? /^seeker-upload:\/\/doc_[0-9A-HJKMNP-TV-Z]{26}$/.test(url)
      : url.startsWith(`seeker-interview://${seekerId}#turn-`) && /#turn-\d+$/.test(url);
  if (!urlOk) bad(at(path, "url"), `does not match tool ${tool} for ${seekerId}`);
  if (typeof o.contentHash !== "string" || !/^[0-9a-f]{64}$/.test(o.contentHash)) bad(at(path, "contentHash"), "must be a SHA-256 hex digest");
  const quote = optional(o, "quote", path, (x, p) => string(x, p, 2000));
  const snapshotKey = optional(o, "snapshotKey", path, (x, p) => string(x, p, 500));
  return {
    id: prefixedId(o.id, at(path, "id"), "src"),
    url,
    title: string(o.title, at(path, "title")),
    fetchedAt: isoDate(o.fetchedAt, at(path, "fetchedAt")),
    tool,
    contentHash: o.contentHash,
    ...(quote !== undefined ? { quote } : {}),
    ...(snapshotKey !== undefined ? { snapshotKey } : {}),
  };
}

// Part 1 only ever produces stated skill claims about the seeker (PLAN.md §5.7).
function statedClaim(v: unknown, path: string, seekerId: string): Claim {
  const o = object(v, path, ["id", "subject", "statement", "skill", "kind", "tier", "sources"], ["validUntil"]);
  const subject = object(o.subject, at(path, "subject"), ["kind", "id"]);
  if (subject.kind !== "seeker" || subject.id !== seekerId) bad(at(path, "subject"), `must be { kind: "seeker", id: "${seekerId}" }`);
  if (o.tier !== "stated") bad(at(path, "tier"), 'must be "stated"');
  const validUntil = optional(o, "validUntil", path, isoDate);
  return {
    id: prefixedId(o.id, at(path, "id"), "clm"),
    subject: { kind: "seeker", id: seekerId },
    statement: string(o.statement, at(path, "statement"), 500),
    skill: taxonomyEntry(o.skill, at(path, "skill")),
    kind: oneOf(o.kind, at(path, "kind"), ["fact", "inference"] as const),
    tier: "stated",
    sources: array(o.sources, at(path, "sources"), (x, p) => source(x, p, seekerId), { min: 1, max: 100 }),
    ...(validUntil !== undefined ? { validUntil } : {}),
  };
}

function period<K extends "organisation" | "institution">(v: unknown, path: string, orgKey: K) {
  const o = object(v, path, ["title"], [orgKey, "from", "to"]);
  const out: Record<string, string> = { title: string(o.title, at(path, "title")) };
  for (const k of [orgKey, "from", "to"]) {
    const val = optional(o, k, path, (x, p) => string(x, p, k === orgKey ? 200 : 32));
    if (val !== undefined) out[k] = val;
  }
  return out as { title: string } & Partial<Record<K | "from" | "to", string>>;
}

function document(v: unknown, path: string, seekerId: string): SeekerDocument {
  const o = object(v, path, ["id", "kind", "fileName", "uploadedAt", "statedSkills", "experience", "education"]);
  if (o.kind !== "cv") bad(at(path, "kind"), 'must be "cv"');
  return {
    id: prefixedId(o.id, at(path, "id"), "doc"),
    kind: "cv",
    fileName: string(o.fileName, at(path, "fileName"), 255),
    uploadedAt: isoDate(o.uploadedAt, at(path, "uploadedAt")),
    statedSkills: array(o.statedSkills, at(path, "statedSkills"), (x, p) => statedClaim(x, p, seekerId), { max: 500 }),
    experience: array(o.experience, at(path, "experience"), (x, p) => period(x, p, "organisation"), { max: 100 }),
    education: array(o.education, at(path, "education"), (x, p) => period(x, p, "institution"), { max: 100 }),
  };
}

function link(v: unknown, path: string): SeekerLink {
  const o = object(v, path, ["url", "kind", "id", "addedAt"]);
  return {
    ...linkInput({ url: o.url, kind: o.kind }, path),
    id: prefixedId(o.id, at(path, "id"), "lnk"),
    addedAt: isoDate(o.addedAt, at(path, "addedAt")),
  };
}

function careerChoice(v: unknown, path: string): CareerChoice {
  const o = object(v, path, ["occupation", "runId", "chosenAt"]);
  return {
    occupation: taxonomyEntry(o.occupation, at(path, "occupation")),
    runId: runId(o.runId, at(path, "runId")),
    chosenAt: isoDate(o.chosenAt, at(path, "chosenAt")),
  };
}

// Full SeekerProfile check, used on fixtures and anywhere a profile crosses a boundary.
// Preferences may be incomplete here (a fresh seeker has none), but status must agree with them.
export function validateSeekerProfile(v: unknown, path = ""): SeekerProfile {
  const o = object(v, path, ["seekerId", "profileVersion", "status", "consent", "preferences", "statedSkills", "documents", "links", "updatedAt"], [
    "careerChoice",
  ]);
  const seekerId = prefixedId(o.seekerId, at(path, "seekerId"), "skr");
  const prefsRaw = o.preferences as Obj;
  const hasOccupations = Array.isArray(prefsRaw?.targetOccupations) && prefsRaw.targetOccupations.length > 0;
  const choice = optional(o, "careerChoice", path, careerChoice);
  const profile: SeekerProfile = {
    seekerId,
    profileVersion: integer(o.profileVersion, at(path, "profileVersion"), 1),
    status: oneOf(o.status, at(path, "status"), ["incomplete", "complete"] as const),
    consent: validateConsent(o.consent, at(path, "consent")),
    preferences: hasOccupations ? validatePreferences(o.preferences, at(path, "preferences")) : incompletePreferences(o.preferences, at(path, "preferences")),
    statedSkills: array(o.statedSkills, at(path, "statedSkills"), (x, p) => statedClaim(x, p, seekerId), { max: 1000 }),
    documents: array(o.documents, at(path, "documents"), (x, p) => document(x, p, seekerId), { max: 20 }),
    links: array(o.links, at(path, "links"), link, { max: 50 }),
    ...(choice !== undefined ? { careerChoice: choice } : {}),
    updatedAt: isoDate(o.updatedAt, at(path, "updatedAt")),
  };
  if (computeStatus(profile) !== profile.status) bad(at(path, "status"), `must be "${computeStatus(profile)}" for these preferences and consent`);
  return profile;
}

// Same shape as CareerPreferences but with targetOccupations allowed to be empty.
function incompletePreferences(v: unknown, path: string): CareerPreferences {
  if (typeof v !== "object" || v === null || Array.isArray(v)) bad(path, "must be an object");
  const o = v as Obj;
  if (!Array.isArray(o.targetOccupations) || o.targetOccupations.length !== 0) bad(at(path, "targetOccupations"), "must be an array");
  const placeholder = { uri: "urn:stub:occupation:placeholder", label: "placeholder", lang: "en" };
  return { ...validatePreferences({ ...o, targetOccupations: [placeholder] }, path), targetOccupations: [] };
}
