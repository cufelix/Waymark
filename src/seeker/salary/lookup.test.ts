import test from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "../core/claims.ts";
import { FakeLlm, MODELS } from "../llm/llm.ts";
import { FakeExa } from "./exa.ts";
import { lookupSalary } from "./lookup.ts";

const page = {
  title: "Technician pay",
  url: "https://salary.example/technician",
  text: "Junior technicians earn 35\u202f000 to 45 000 CZK per month in Prague.",
};

test("lookupSalary keeps only quoted figures whose amounts occur in the quote", async () => {
  const exa = new FakeExa([page]);
  const llm = new FakeLlm([JSON.stringify({
    figures: [{
      amountMin: 35000,
      amountMax: 45000,
      currency: "CZK",
      period: "month",
      level: "junior",
      url: page.url,
      quote: "Junior technicians earn 35 000 to 45 000 CZK per month in Prague.",
    }],
  })]);

  const result = await lookupSalary(
    { llm, exa },
    { occupation: "computer service technician", country: "CZ", city: "Prague", lang: "cs" },
  );

  assert.deepEqual(exa.calls, [{ query: "computer service technician salary Prague CZ per month", numResults: 5 }]);
  assert.equal(llm.calls[0].model, MODELS.fast);
  assert.equal(llm.calls[0].json, true);
  assert.equal(result.figures.length, 1);
  assert.deepEqual(result.figures[0], {
    amountMin: 35000,
    amountMax: 45000,
    currency: "CZK",
    period: "month",
    level: "junior",
    url: page.url,
    quote: "Junior technicians earn 35 000 to 45 000 CZK per month in Prague.",
  });
  assert.equal(result.sources.length, 1);
  assert.match(result.sources[0].id, /^src_/);
  assert.equal(result.sources[0].tool, "exa");
  assert.equal(result.sources[0].contentHash, sha256(page.text));
});

test("lookupSalary drops a figure whose quote is not on its page", async () => {
  const exa = new FakeExa([page]);
  const llm = new FakeLlm([JSON.stringify({
    figures: [{ amountMin: 35000, currency: "CZK", period: "month", url: page.url, quote: "Made-up salary 35 000 CZK" }],
  })]);

  assert.deepEqual(
    await lookupSalary({ llm, exa }, { occupation: "technician", country: "CZ", lang: "en" }),
    { figures: [], sources: [] },
  );
});

test("lookupSalary drops a figure when an extracted amount is absent from the quote", async () => {
  const exa = new FakeExa([page]);
  const llm = new FakeLlm([JSON.stringify({
    figures: [{ amountMin: 35000, amountMax: 99000, currency: "CZK", period: "month", url: page.url, quote: page.text }],
  })]);

  assert.deepEqual(
    await lookupSalary({ llm, exa }, { occupation: "technician", country: "CZ", lang: "en" }),
    { figures: [], sources: [] },
  );
});
