import { test } from "node:test";
import assert from "node:assert/strict";
import { newId } from "./ids.ts";
import { ApiError, fail, ok } from "./errors.ts";
import { MemoryStore } from "../store/memory.ts";
import { FakeLlm } from "../llm/llm.ts";
import { mergeStatedSkills, removeSources, touch, emptyPreferences } from "./profile.ts";

test("ids are prefix_ + 26-char ULID and unique", () => {
  const a = newId("skr");
  assert.match(a, /^skr_[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.notEqual(a, newId("skr"));
});

test("envelope shapes", () => {
  assert.deepEqual(ok({ x: 1 }, "req_1"), { ok: true, data: { x: 1 }, error: null, meta: { requestId: "req_1" } });
  const f = fail(new ApiError("not_found", "nope"), "req_2");
  assert.equal(f.status, 404);
  assert.deepEqual(f.body.error, { code: "not_found", message: "nope" });
  assert.equal(fail(new Error("leak secret")).body.error?.message, "Internal error");
});

test("memory store updates are isolated copies", async () => {
  const s = new MemoryStore();
  const rec: any = { profile: { seekerId: "skr_1", profileVersion: 1 }, interview: [], draft: {}, cvTexts: {} };
  await s.create(rec);
  const u = await s.update("skr_1", (r) => ({ ...r, profile: { ...r.profile, profileVersion: 2 } }));
  assert.equal(u.profile.profileVersion, 2);
  await assert.rejects(s.update("skr_x", (r) => r), /does not exist/);
});

test("fake llm returns queued answers", async () => {
  const llm = new FakeLlm(["a"]);
  assert.equal(await llm.chat({ model: "m", messages: [] }), "a");
});

test("touch bumps version and computes status", () => {
  const p: any = { seekerId: "skr_1", profileVersion: 1, status: "incomplete", consent: { dataProcessing: true }, preferences: emptyPreferences(), statedSkills: [], documents: [], links: [], updatedAt: "" };
  assert.equal(touch(p).status, "incomplete");
  p.preferences.targetOccupations = [{ uri: "u", label: "x", lang: "en" }];
  const t = touch(p);
  assert.equal(t.status, "complete");
  assert.equal(t.profileVersion, 2);
});

test("stated skills merge by uri and drop when sources are removed", () => {
  const skill = { uri: "s:docker", label: "Docker", lang: "en" };
  const c = (url: string): any => ({ id: url, skill, sources: [{ url, quote: "q" }] });
  const merged = mergeStatedSkills([c("seeker-upload://doc_A")], [c("seeker-interview://skr_1#turn-2")]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].sources.length, 2);
  assert.equal(removeSources(merged, "seeker-upload://doc_A")[0].sources.length, 1);
  assert.equal(removeSources(removeSources(merged, "seeker-upload://doc_A"), "seeker-interview://").length, 0);
});

test("unfence strips a json fence from JSON-mode replies", async () => {
  const { unfence } = await import("../llm/llm.ts");
  assert.equal(unfence('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(unfence('{"a":1}'), '{"a":1}');
  assert.equal(unfence("no json here"), "no json here");
});
