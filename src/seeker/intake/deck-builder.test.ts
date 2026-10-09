import assert from "node:assert/strict";
import { test } from "node:test";
import type { Occupation } from "../contracts.ts";
import { sha256 } from "../core/claims.ts";
import { FakeLlm } from "../llm/llm.ts";
import { FakeExa } from "../salary/exa.ts";
import { buildDeck } from "./deck-builder.ts";
import { validateDeck } from "./deck.ts";

const PAGE = [
  "Join our deliberately fake example company.",
  "You will investigate\n recurring checkout failures and explain the cause to the team.",
  "You will answer customer questions and document recurring problems.",
  "You will test fixes before they are released.",
].join("\n");

const modelTasks = (path: "backend" | "support"): string => JSON.stringify({
  tasks: [
    {
      text: "Find recurring checkout failures and explain what caused them.",
      quote: "You will investigate recurring checkout failures and explain the cause to the team.",
      adIndex: 0,
      url: "https://model.example/ignore-this",
      related: [
        { key: path === "backend" ? "support" : "backend", weight: 0.4 },
        { key: "outside-the-deck", weight: 0.9 },
        { key: path, weight: 0.8 },
      ],
    },
    {
      text: "Answer customer questions and write down problems that repeat.",
      quote: "You will answer customer questions and document recurring problems.",
      adIndex: 0,
      related: [],
    },
    {
      text: "Test fixes before customers receive them.",
      quote: "You will test fixes before they are released.",
      adIndex: 0,
      related: [],
    },
    {
      text: "Invent a task that the ad never mentioned.",
      quote: "This fabricated sentence is not in the page.",
      adIndex: 0,
      related: [],
    },
  ],
});

test("buildDeck keeps grounded exact quotes and ignores model URLs and unknown related keys", async () => {
  const exa = new FakeExa([{ url: "https://example.com/jobs/fake-1", title: "[FAKE] Entry-level role", text: PAGE }]);
  const llm = new FakeLlm([modelTasks("backend"), modelTasks("support")]);
  const occupations = [
    { key: "backend", label: "Backend developer", kind: "coding" },
    { key: "support", label: "Customer support specialist", kind: "helping people" },
  ];
  const resolveOccupation = async (label: string, lang: string): Promise<Occupation> => ({
    uri: `urn:stub:occupation:${label.toLowerCase().replaceAll(" ", "-")}`,
    label,
    lang,
  });
  let dropped = 0;

  const deck = await buildDeck({
    country: "CZ",
    occupations,
    exa,
    llm,
    resolveOccupation,
    now: () => "2026-10-09T12:00:00Z",
    onDrop: () => dropped++,
  });

  assert.doesNotThrow(() => validateDeck(deck));
  assert.equal(deck.version, "2026-10-09");
  assert.equal(deck.cards.length, 6);
  assert.equal(dropped, 2);
  assert.equal(exa.calls.length, 2);
  assert.equal(exa.calls[0]?.query, "junior backendový vývojář nabídka práce Praha");
  assert.ok(llm.calls.every((call) => call.model.length > 0 && call.json === true));

  const first = deck.cards[0];
  assert.ok(first);
  assert.equal(first.source.url, "https://example.com/jobs/fake-1");
  assert.equal(first.source.quote, "You will investigate\n recurring checkout failures and explain the cause to the team.");
  assert.ok(PAGE.includes(first.source.quote));
  assert.equal(first.source.contentHash, sha256(PAGE));
  assert.deepEqual(first.related, [{ occupation: deck.paths[1]?.occupation, weight: 0.4 }]);
  assert.ok(deck.cards.every((card) => !card.source.quote.includes("fabricated")));
});

test("buildDeck rejects short or partial quotes and keeps only a useful whole sentence", async () => {
  const exa = new FakeExa([{ url: "https://example.com/jobs/fake-quote", title: "[FAKE] Quote role", text: PAGE }]);
  const llm = new FakeLlm([JSON.stringify({ tasks: [
    {
      text: "Test fixes.",
      quote: "test fixes",
      adIndex: 0,
      related: [],
    },
    {
      text: "Document recurring problems.",
      quote: "answer customer questions and document recurring problems.",
      adIndex: 0,
      related: [],
    },
    {
      text: "Answer questions and document recurring problems.",
      quote: "You will answer customer questions and document recurring problems.",
      adIndex: 0,
      related: [],
    },
  ] })]);
  let dropped = 0;

  const deck = await buildDeck({
    country: "CZ",
    occupations: [{ key: "support", label: "Customer support specialist", kind: "helping people" }],
    exa,
    llm,
    resolveOccupation: async (label, lang) => ({ uri: "urn:stub:occupation:support", label, lang }),
    now: () => "2026-10-09T12:00:00Z",
    onDrop: () => dropped++,
    warn: () => {},
  });

  assert.equal(dropped, 2);
  assert.deepEqual(deck.cards.map((card) => card.source.quote), [
    "You will answer customer questions and document recurring problems.",
  ]);
});

test("buildDeck warns but keeps a path with fewer than two grounded cards", async () => {
  const exa = new FakeExa([{ url: "https://example.com/jobs/fake-2", title: "[FAKE] Small ad", text: PAGE }]);
  const llm = new FakeLlm([JSON.stringify({ tasks: [{
    text: "Test fixes before customers receive them.",
    quote: "You will test fixes before they are released.",
    adIndex: 0,
    related: [],
  }] })]);
  const warnings: string[] = [];

  const deck = await buildDeck({
    country: "CZ",
    occupations: [{ key: "qa", label: "QA tester", kind: "testing" }],
    exa,
    llm,
    resolveOccupation: async (label, lang) => ({ uri: "urn:stub:occupation:qa", label, lang }),
    now: () => "2026-10-09T12:00:00Z",
    warn: (message) => warnings.push(message),
  });

  assert.equal(deck.cards.length, 1);
  assert.deepEqual(warnings, ["Intake deck: qa has only 1 grounded card"]);
  assert.doesNotThrow(() => validateDeck(deck));
});
