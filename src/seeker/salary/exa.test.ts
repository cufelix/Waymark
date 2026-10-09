import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../core/errors.ts";
import { FakeExa, HttpExaClient } from "./exa.ts";

test("HttpExaClient sends the contracted search request and reads Exa results", async () => {
  let seenUrl = "";
  let seenInit: RequestInit | undefined;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    seenUrl = String(input);
    seenInit = init;
    return new Response(JSON.stringify({
      requestId: "req_fake",
      results: [{ id: "exa_fake", title: "Salary page", url: "https://salary.example/role", text: "Salary text" }],
      costDollars: { total: 0.007 },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  const client = new HttpExaClient("fake-key", fetchImpl);
  const results = await client.search("technician salary Prague CZ per month", 5);

  assert.equal(seenUrl, "https://api.exa.ai/search");
  assert.equal(seenInit?.method, "POST");
  assert.deepEqual(seenInit?.headers, { "x-api-key": "fake-key", "Content-Type": "application/json" });
  assert.deepEqual(JSON.parse(String(seenInit?.body)), {
    query: "technician salary Prague CZ per month",
    numResults: 5,
    contents: { text: { maxCharacters: 4000 } },
  });
  assert.ok(seenInit?.signal instanceof AbortSignal);
  assert.deepEqual(results, [{ title: "Salary page", url: "https://salary.example/role", text: "Salary text" }]);
});

test("HttpExaClient sanitizes an upstream HTTP error", async () => {
  const fetchImpl = (async () => new Response("fake upstream password=do-not-leak", { status: 503 })) as typeof fetch;
  const client = new HttpExaClient("fake-key", fetchImpl);

  await assert.rejects(client.search("query", 5), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "upstream_failed");
    assert.equal(error.message, "Search provider returned 503");
    assert.doesNotMatch(error.message, /password|do-not-leak/);
    return true;
  });
});

test("FakeExa returns copies and records calls", async () => {
  const fake = new FakeExa([{ title: "Fake", url: "https://fake.example", text: "Fake text" }]);
  const result = await fake.search("fake query", 5);
  result[0].text = "changed";

  assert.deepEqual(fake.calls, [{ query: "fake query", numResults: 5 }]);
  assert.equal((await fake.search("again", 1))[0].text, "Fake text");
});
