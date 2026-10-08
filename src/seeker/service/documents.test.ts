import assert from "node:assert/strict";
import { test } from "node:test";
import type { Claim, SeekerProfile } from "../contracts.ts";
import { interviewSource, now, statedSkillClaim } from "../core/claims.ts";
import { ApiError } from "../core/errors.ts";
import { emptyPreferences } from "../core/profile.ts";
import { JANE_EXAMPLE_XML, makeDocx } from "../cv/testdata/make-docx.ts";
import { FakeLlm, MODELS } from "../llm/llm.ts";
import { MemoryStore } from "../store/memory.ts";
import { deleteDocument, uploadCv } from "./documents.ts";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const SEEKER_ID = "skr_test";

function profile(statedSkills: Claim[] = []): SeekerProfile {
  return {
    seekerId: SEEKER_ID,
    profileVersion: 1,
    status: "incomplete",
    consent: { dataProcessing: true, nameSearch: false, givenAt: now(), policyVersion: "test" },
    preferences: emptyPreferences(),
    statedSkills,
    documents: [],
    links: [],
    updatedAt: now(),
  };
}

async function setup(statedSkills: Claim[] = [], deletionPending = false): Promise<MemoryStore> {
  const store = new MemoryStore();
  await store.create({ profile: profile(statedSkills), interview: [], draft: {}, cvTexts: {}, ...(deletionPending ? { deletionPending: true } : {}) });
  return store;
}

function extraction(skills: { label: string; quote: string }[] = [{ label: "TypeScript", quote: "Built APIs with TypeScript" }]): string {
  return JSON.stringify({
    skills,
    experience: [{ title: "Software Developer", organisation: "Example Org", from: "2022", to: "2026" }],
    education: [{ title: "BSc Computer Science", institution: "Example University" }],
  });
}

async function expectCode(promise: Promise<unknown>, code: ApiError["code"]): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, code);
    return true;
  });
}

test("DOCX upload extracts details, stores text, and creates stated upload evidence", async () => {
  const store = await setup();
  const llm = new FakeLlm([extraction()]);
  const bytes = makeDocx(JANE_EXAMPLE_XML);
  const document = await uploadCv({ store, llm }, SEEKER_ID, { fileName: "jane-example.docx", mimeType: DOCX_MIME, bytes });

  assert.match(document.id, /^doc_/);
  assert.equal(document.kind, "cv");
  assert.equal(document.statedSkills.length, 1);
  assert.equal(document.statedSkills[0].tier, "stated");
  assert.equal(document.statedSkills[0].sources[0].url, `seeker-upload://${document.id}`);
  assert.equal(document.statedSkills[0].sources[0].tool, "seeker-upload");
  assert.equal(document.experience[0].organisation, "Example Org");
  assert.equal(document.education[0].institution, "Example University");
  assert.equal(llm.calls.length, 1);
  assert.equal(llm.calls[0].model, MODELS.cv);

  const stored = await store.get(SEEKER_ID);
  assert.equal(stored?.profile.profileVersion, 2);
  assert.equal(stored?.profile.documents[0].id, document.id);
  assert.equal(stored?.profile.statedSkills.length, 1);
  assert.equal(stored?.cvTexts[document.id], "Jane Example\nSoftware Developer & mentor\nBuilt APIs with TypeScript");
});

test("PDF upload transcribes first, then makes one extraction call on the text", async () => {
  const store = await setup();
  const llm = new FakeLlm(["Jane Example\nBuilt APIs with TypeScript", extraction()]);
  const bytes = Buffer.from("%PDF-1.7\ntiny fake PDF for FakeLlm");
  const document = await uploadCv({ store, llm }, SEEKER_ID, { fileName: "jane.pdf", mimeType: "application/pdf", bytes });

  assert.equal(document.statedSkills.length, 1);
  assert.deepEqual(llm.calls.map((call) => call.model), [MODELS.fast, MODELS.cv]);
  assert.match(String(llm.calls[1].messages[0].content), /Jane Example\nBuilt APIs with TypeScript/);
});

test("an invented skill quote is dropped", async () => {
  const store = await setup();
  const llm = new FakeLlm([extraction([{ label: "Kubernetes", quote: "Operated Kubernetes clusters" }])]);
  const document = await uploadCv(
    { store, llm },
    SEEKER_ID,
    { fileName: "jane.docx", mimeType: DOCX_MIME, bytes: makeDocx(JANE_EXAMPLE_XML) },
  );
  assert.deepEqual(document.statedSkills, []);
  assert.deepEqual((await store.get(SEEKER_ID))?.profile.statedSkills, []);
});

test("a skill quote with altered whitespace is dropped because it is not verbatim", async () => {
  const store = await setup();
  const llm = new FakeLlm([extraction([{ label: "TypeScript", quote: "Built  APIs with TypeScript" }])]);
  const document = await uploadCv(
    { store, llm },
    SEEKER_ID,
    { fileName: "jane.docx", mimeType: DOCX_MIME, bytes: makeDocx(JANE_EXAMPLE_XML) },
  );
  assert.deepEqual(document.statedSkills, []);
  assert.deepEqual((await store.get(SEEKER_ID))?.profile.statedSkills, []);
});

test("files over 10 MB and renamed non-CVs are unprocessable without LLM calls", async () => {
  const store = await setup();
  const llm = new FakeLlm([]);
  await expectCode(
    uploadCv({ store, llm }, SEEKER_ID, { fileName: "large.pdf", mimeType: "application/pdf", bytes: new Uint8Array(10 * 1024 * 1024 + 1) }),
    "unprocessable",
  );
  await expectCode(
    uploadCv({ store, llm }, SEEKER_ID, { fileName: "renamed.docx", mimeType: DOCX_MIME, bytes: Buffer.from("This is really a text file") }),
    "unprocessable",
  );
  assert.equal(llm.calls.length, 0);
});

test("garbage extraction JSON retries once and then reports upstream_failed", async () => {
  const store = await setup();
  const llm = new FakeLlm(["garbage", "still garbage"]);
  await expectCode(
    uploadCv({ store, llm }, SEEKER_ID, { fileName: "jane.docx", mimeType: DOCX_MIME, bytes: makeDocx(JANE_EXAMPLE_XML) }),
    "upstream_failed",
  );
  assert.equal(llm.calls.length, 2);
  assert.equal((await store.get(SEEKER_ID))?.profile.documents.length, 0);
});

test("delete removes document text and upload evidence but preserves interview evidence for the same skill", async () => {
  const skill = { uri: "urn:stub:skill:typescript", label: "TypeScript", lang: "en" };
  const interviewClaim = statedSkillClaim(SEEKER_ID, skill, interviewSource(SEEKER_ID, 2, "I use TypeScript", "TypeScript"));
  const store = await setup([interviewClaim]);
  const document = await uploadCv(
    { store, llm: new FakeLlm([extraction()]) },
    SEEKER_ID,
    { fileName: "jane.docx", mimeType: DOCX_MIME, bytes: makeDocx(JANE_EXAMPLE_XML) },
  );
  const before = await store.get(SEEKER_ID);
  assert.equal(before?.profile.statedSkills.length, 1);
  assert.equal(before?.profile.statedSkills[0].sources.length, 2);

  assert.deepEqual(await deleteDocument({ store, llm: new FakeLlm([]) }, SEEKER_ID, document.id), { deleted: true });
  const after = await store.get(SEEKER_ID);
  assert.deepEqual(after?.profile.documents, []);
  assert.equal(after?.cvTexts[document.id], undefined);
  assert.equal(after?.profile.statedSkills.length, 1);
  assert.equal(after?.profile.statedSkills[0].sources.length, 1);
  assert.match(after?.profile.statedSkills[0].sources[0].url ?? "", /^seeker-interview:\/\//);
  assert.equal(after?.profile.profileVersion, 3);
});

test("unknown and deletion-pending seekers and unknown documents return not_found", async () => {
  const store = await setup();
  const deps = { store, llm: new FakeLlm([]) };
  await expectCode(deleteDocument(deps, SEEKER_ID, "doc_missing"), "not_found");
  await expectCode(deleteDocument(deps, "skr_missing", "doc_missing"), "not_found");
  await expectCode(
    uploadCv(deps, "skr_missing", { fileName: "jane.docx", mimeType: DOCX_MIME, bytes: makeDocx(JANE_EXAMPLE_XML) }),
    "not_found",
  );

  const pendingStore = await setup([], true);
  await expectCode(
    uploadCv(
      { store: pendingStore, llm: new FakeLlm([]) },
      SEEKER_ID,
      { fileName: "jane.docx", mimeType: DOCX_MIME, bytes: makeDocx(JANE_EXAMPLE_XML) },
    ),
    "not_found",
  );
  await expectCode(deleteDocument({ store: pendingStore, llm: new FakeLlm([]) }, SEEKER_ID, "doc_any"), "not_found");
});
