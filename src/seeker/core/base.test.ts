import { test } from "node:test";
import assert from "node:assert/strict";
import { newId } from "./ids.ts";
import { ApiError, fail, ok } from "./errors.ts";
import { MemoryStore } from "../store/memory.ts";
import { FakeLlm } from "../llm/llm.ts";

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
