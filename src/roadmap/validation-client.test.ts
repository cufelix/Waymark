import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../seeker/core/errors.ts";
import { VALIDATION } from "./testdata/validation.ts";
import { HttpValidationReader, validationReaderFromEnv } from "./validation-client.ts";

const json = (data: unknown, init: ResponseInit = {}): Response => new Response(JSON.stringify(data), {
  status: 200,
  headers: { "content-type": "application/json" },
  ...init,
});

test("reads a shape-checked validation with bearer auth", async () => {
  let requestedUrl = "";
  let authorization = "";
  const validation = structuredClone(VALIDATION);
  validation.runId = "run_01m4f43g5em4g0p73dptff8a7r";
  validation.skills[0]!.demand.sources[0]!.tool = "official-api";
  validation.skills[0]!.demand.sources[0]!.id = "src_01m4f43g5em4g0p73dptff8a7r";
  const reader = new HttpValidationReader({
    baseUrl: "https://validation.example/",
    apiKey: "part3-secret",
    fetchImpl: async (input, init) => {
      requestedUrl = String(input);
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return json({ ok: true, data: validation, error: null, meta: { requestId: "req_test" } });
    },
  });

  assert.deepEqual(await reader.getValidation(VALIDATION.validationId), validation);
  assert.equal(requestedUrl, `https://validation.example/v1/validations/${VALIDATION.validationId}`);
  assert.equal(authorization, "Bearer part3-secret");
});

test("maps only a missing validation to not_found", async () => {
  const missing = new HttpValidationReader({
    baseUrl: "https://validation.example",
    apiKey: "key",
    fetchImpl: async () => json({ ok: false, data: null, error: { code: "not_found", message: "missing" } }, { status: 404 }),
  });
  await assert.rejects(() => missing.getValidation(VALIDATION.validationId), (error) => (
    error instanceof ApiError && error.code === "not_found" && error.message === "Validation not found"
  ));

  const unavailable = new HttpValidationReader({
    baseUrl: "https://validation.example",
    apiKey: "key",
    fetchImpl: async () => json({ ok: false, data: null, error: { message: "private upstream detail" } }, { status: 503 }),
  });
  await assert.rejects(() => unavailable.getValidation(VALIDATION.validationId), (error) => (
    error instanceof ApiError
      && error.code === "upstream_failed"
      && error.message === "Validation service returned 503"
      && !error.message.includes("private upstream detail")
  ));
});

test("rejects successful envelopes whose validation shape is incomplete", async () => {
  const cases: unknown[] = [
    { ...structuredClone(VALIDATION), profileVersion: "3" },
    { ...structuredClone(VALIDATION), validationId: "val_00000000000000000000000002" },
    { ...structuredClone(VALIDATION), companies: undefined },
    { ...structuredClone(VALIDATION), skills: [{ ...VALIDATION.skills[0], demand: { vacanciesRequiring: 1 } }] },
    { ...structuredClone(VALIDATION), jobProfile: { ...VALIDATION.jobProfile, ladder: [{}] } },
  ];

  for (const data of cases) {
    const reader = new HttpValidationReader({
      baseUrl: "https://validation.example",
      apiKey: "key",
      fetchImpl: async () => json({ ok: true, data, error: null }),
    });
    await assert.rejects(() => reader.getValidation(VALIDATION.validationId), (error) => (
      error instanceof ApiError
        && error.code === "upstream_failed"
        && error.message === "Validation service returned an unexpected response"
    ));
  }
});

test("rejects copied IDs with malformed prefixes and claims without sources", async () => {
  const malformedValidation = structuredClone(VALIDATION);
  malformedValidation.validationId = "validation_wrong";
  const malformedSeeker = structuredClone(VALIDATION);
  malformedSeeker.seekerId = "seeker_wrong";
  const malformedRun = structuredClone(VALIDATION);
  malformedRun.runId = "research_wrong";
  const malformedClaim = structuredClone(VALIDATION);
  malformedClaim.jobProfile.ladder![0]!.claims[0]!.id = "claim_wrong";
  const malformedSource = structuredClone(VALIDATION);
  malformedSource.skills[0]!.demand.sources[0]!.id = "source_wrong";
  const emptyClaimSources = structuredClone(VALIDATION);
  emptyClaimSources.jobProfile.ladder![0]!.claims[0]!.sources = [];

  const cases = [
    { requestedId: malformedValidation.validationId, data: malformedValidation },
    { requestedId: VALIDATION.validationId, data: malformedSeeker },
    { requestedId: VALIDATION.validationId, data: malformedRun },
    { requestedId: VALIDATION.validationId, data: malformedClaim },
    { requestedId: VALIDATION.validationId, data: malformedSource },
    { requestedId: VALIDATION.validationId, data: emptyClaimSources },
  ];
  for (const { requestedId, data } of cases) {
    const reader = new HttpValidationReader({
      baseUrl: "https://validation.example",
      apiKey: "key",
      fetchImpl: async () => json({ ok: true, data, error: null }),
    });
    await assert.rejects(() => reader.getValidation(requestedId), (error) => (
      error instanceof ApiError
        && error.code === "upstream_failed"
        && error.message === "Validation service returned an unexpected response"
    ));
  }
});

test("network errors are sanitized and environment configuration follows Part 3 fallbacks", async () => {
  const secret = "never-repeat-this-key";
  const reader = new HttpValidationReader({
    baseUrl: "https://validation.example",
    apiKey: secret,
    fetchImpl: async () => {
      throw new Error(secret);
    },
  });
  await assert.rejects(() => reader.getValidation(VALIDATION.validationId), (error) => (
    error instanceof ApiError && error.code === "upstream_failed" && !error.message.includes(secret)
  ));

  const previous = {
    part3Url: process.env.PART3_BASE_URL,
    part3Key: process.env.PART3_API_KEY,
    part2Url: process.env.PART2_BASE_URL,
    part2Key: process.env.PART2_API_KEY,
  };
  process.env.PART3_BASE_URL = "https://part3.example/";
  process.env.PART3_API_KEY = "configured-key";
  delete process.env.PART2_BASE_URL;
  delete process.env.PART2_API_KEY;
  try {
    const configured = validationReaderFromEnv();
    assert.ok(configured instanceof HttpValidationReader);
    assert.equal(configured.baseUrl, "https://part3.example");
  } finally {
    for (const [key, value] of Object.entries({
      PART3_BASE_URL: previous.part3Url,
      PART3_API_KEY: previous.part3Key,
      PART2_BASE_URL: previous.part2Url,
      PART2_API_KEY: previous.part2Key,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
