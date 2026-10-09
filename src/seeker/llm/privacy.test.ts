import assert from "node:assert/strict";
import test from "node:test";
import { openRouterProviderPolicy } from "../../openrouter-privacy.ts";
import { OpenRouterClient } from "./llm.ts";

test("OpenRouter provider routing defaults to zero retention and no data collection", () => {
  assert.deepEqual(openRouterProviderPolicy({}), { zdr: true, data_collection: "deny" });
  assert.deepEqual(openRouterProviderPolicy({ OPENROUTER_ZDR: "0" }), { zdr: false, data_collection: "deny" });
  assert.deepEqual(
    openRouterProviderPolicy({ OPENROUTER_ZDR: "off", OPENROUTER_DATA_COLLECTION: "allow" }),
    { zdr: false, data_collection: "allow" },
  );
});

test("OpenRouterClient sends the privacy provider policy", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new OpenRouterClient("test-key");
    assert.equal(await client.chat({ model: "example/model", messages: [{ role: "user", content: "hello" }] }), "ok");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requestBody?.provider, { zdr: true, data_collection: "deny" });
});
