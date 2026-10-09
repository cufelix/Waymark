import assert from "node:assert/strict";
import test from "node:test";
import { errorMessage, safeLogFields } from "./log.ts";

test("safeLogFields redacts secret-bearing fields, URLs, email addresses and bearer values recursively", () => {
  const safe = safeLogFields({
    url: "https://portfolio.example/jane?token=private",
    note: "Contact jane@example.com or open https://example.com/private",
    authorization: "Bearer secret-value",
    nested: { prompt: "private CV text", status: "failed" },
  });

  assert.deepEqual(safe, {
    url: "[url]",
    note: "Contact [email] or open [url]",
    authorization: "[redacted]",
    nested: { prompt: "[redacted]", status: "failed" },
  });
});

test("errorMessage keeps an error category and safe code without retaining its message", () => {
  const error = Object.assign(new Error("CV text and provider-key-must-not-appear"), { code: "ETIMEDOUT" });

  assert.equal(errorMessage(error), "Error (ETIMEDOUT)");
  assert.equal(errorMessage("raw provider body"), "string");
});
