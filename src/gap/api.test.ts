import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../seeker/core/errors.ts";
import { handle, type GapDeps } from "./api.ts";
import type { Validation } from "./contracts.ts";
import { FakePart2Client } from "./part2-client.ts";
import { MemoryGapStore } from "./store.ts";
import { CAREER_PATHS, COMPANIES, MARKET, OCC, PROFILE, RUN, SEEKER_RESEARCH, TRENDS, VACANCIES } from "./testdata/run.ts";

function deps(store = new MemoryGapStore()): GapDeps {
  return {
    store,
    apiKeys: ["test-key"],
    part2: new FakePart2Client({
      run: RUN,
      careerPaths: CAREER_PATHS,
      market: MARKET,
      trends: [TRENDS],
      seekerResearch: SEEKER_RESEARCH,
      companies: COMPANIES,
      vacancies: VACANCIES,
    }),
  };
}

const auth = { Authorization: "Bearer test-key" };
const seekerId = "skr_00000000000000000000000000";
const firstId = "val_00000000000000000000000000";
const secondId = "val_00000000000000000000000001";
const validation = (id: string): Validation => ({
  validationId: id,
  seekerId,
  runId: RUN.runId,
  profileVersion: RUN.profileVersion,
  createdAt: "2026-10-09T00:00:00Z",
  occupation: OCC,
  locations: [{ country: "CZ", city: "Prague" }],
  jobProfile: { occupation: OCC, vacanciesAnalysed: 0, markets: [], skills: [] },
  skills: [],
  companies: [],
  market: [],
});

test("missing authentication is rejected before routing", async () => {
  const response = await handle({ method: "GET", path: "/v1/no-such-route" }, deps());
  assert.equal(response.status, 401);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.error?.code, "unauthorized");
  assert.match(response.body.meta.requestId, /^req_/);
});

test("GET, list, and DELETE use envelopes and the validation store", async () => {
  const store = new MemoryGapStore();
  const first = validation(firstId);
  const second = validation(secondId);
  await store.put(first);
  await store.put(second);
  const api = deps(store);

  const get = await handle({ method: "GET", path: `/v1/validations/${firstId}`, headers: auth }, api);
  assert.equal(get.status, 200);
  assert.deepEqual(get.body.ok && get.body.data, first);

  const list = await handle({ method: "GET", path: `/v1/seekers/${seekerId}/validations?page=9`, headers: auth }, api);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.ok && list.body.data, [first, second]);

  const remove = await handle({ method: "DELETE", path: `/v1/seekers/${seekerId}/validations`, headers: auth }, api);
  assert.equal(remove.status, 200);
  assert.deepEqual(remove.body.ok && remove.body.data, { deleted: true, validations: 2 });
});

test("unknown validation and route return not_found", async () => {
  const api = deps();
  const missingId = "val_00000000000000000000000002";
  const missing = await handle({ method: "GET", path: `/v1/validations/${missingId}`, headers: auth }, api);
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error?.code, "not_found");
  const unknown = await handle({ method: "GET", path: "/v1/unknown", headers: auth }, api);
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error?.code, "not_found");
});

test("Part 2 errors return 502 without leaking the upstream body", async () => {
  const api = deps();
  api.part2.getRun = async () => {
    throw new ApiError("upstream_failed", "Research service returned 503");
  };
  const response = await handle({ method: "POST", path: "/v1/validations", headers: auth, body: {} }, api);
  // Body validation happens first, so use a structurally valid request to reach Part 2.
  const validResponse = await handle({
    method: "POST",
    path: "/v1/validations",
    headers: auth,
    body: {
      profile: PROFILE,
      runId: RUN.runId,
    },
  }, api);
  assert.equal(response.status, 422);
  assert.equal(validResponse.status, 502);
  assert.deepEqual(validResponse.body.error, { code: "upstream_failed", message: "Research service returned 503" });
});
