import assert from "node:assert/strict";
import { test } from "node:test";
import { loadDeck, validateDeck } from "./deck.ts";
import { FAKE_DECK } from "./testdata/deck.ts";

test("fake CZ intake deck validates and loads from disk", () => {
  assert.doesNotThrow(() => validateDeck(FAKE_DECK));
  const loaded = loadDeck("CZ");
  assert.deepEqual(loaded, FAKE_DECK);
  assert.equal(loaded.paths.length, 8);
  assert.equal(loaded.cards.length, 24);
  assert.ok(loaded.cards.every((card) => card.source.url.startsWith("https://example.com/")));
});
