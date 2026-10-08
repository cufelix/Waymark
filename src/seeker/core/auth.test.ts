import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "./errors.ts";
import { authenticate, parseApiKeys } from "./auth.ts";

const unauthorized = (fn: () => unknown) => assert.throws(fn, (e: unknown) => e instanceof ApiError && e.code === "unauthorized" && e.status === 401);

test("parseApiKeys splits, trims and drops empties", () => {
  assert.deepEqual(parseApiKeys(" k1, k2 ,,"), ["k1", "k2"]);
  assert.deepEqual(parseApiKeys(undefined), []);
  assert.deepEqual(parseApiKeys(""), []);
});

test("valid bearer key passes, header name is case-insensitive", () => {
  authenticate({ authorization: "Bearer k2" }, ["k1", "k2"]);
  authenticate({ Authorization: "bearer k1" }, ["k1"]);
  authenticate({ authorization: ["Bearer k1"] }, ["k1"]);
});

test("missing, malformed, wrong or prefix keys are rejected", () => {
  unauthorized(() => authenticate({}, ["k1"]));
  unauthorized(() => authenticate({ authorization: "k1" }, ["k1"]));
  unauthorized(() => authenticate({ authorization: "Basic k1" }, ["k1"]));
  unauthorized(() => authenticate({ authorization: "Bearer k" }, ["k1"]));
  unauthorized(() => authenticate({ authorization: "Bearer k1x" }, ["k1"]));
  unauthorized(() => authenticate({ authorization: "Bearer k1 k2" }, ["k1"]));
});

test("no configured keys rejects everything", () => {
  unauthorized(() => authenticate({ authorization: "Bearer " }, []));
  unauthorized(() => authenticate({ authorization: "Bearer anything" }, []));
});
