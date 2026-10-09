import assert from "node:assert/strict";
import { test } from "node:test";
import { loadDeck, validateDeck } from "./deck.ts";
import { FAKE_DECK } from "./testdata/deck.ts";

test("the fake test deck validates", () => {
  assert.doesNotThrow(() => validateDeck(FAKE_DECK));
});

test("the real CZ deck on disk validates and every path has grounded cards", () => {
  const loaded = loadDeck("CZ");
  assert.doesNotThrow(() => validateDeck(loaded));
  assert.ok(loaded.cards.length >= 24);
  for (const path of loaded.paths) {
    assert.ok(loaded.cards.filter((card) => card.pathKey === path.key).length >= 2, path.key);
  }
  assert.ok(loaded.cards.every((card) => /^https:\/\//.test(card.source.url) && !card.source.url.includes("example.com")));
  assert.ok(loaded.cards.every((card) => card.source.quote && card.source.quote.length >= 20));
});
