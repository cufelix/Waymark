import assert from "node:assert/strict";
import test from "node:test";
import { sha256 } from "../seeker/core/claims.ts";
import { FakeLlm, MODELS } from "../seeker/llm/llm.ts";
import { FakeExa, type ExaClient, type ExaResult } from "../seeker/salary/exa.ts";
import type { LearningResource, RoadmapChapter } from "./contracts.ts";
import { findResources, MemoryResourceCache, type ResourceCache } from "./resources.ts";
import { EXA_PAGES, OCCUPATION, PYTHON, SQL } from "./testdata/validation.ts";

const context = { occupation: OCCUPATION, goal: "learn-fast" as const, langs: ["en", "cs"] };

function chapter(overrides: Partial<RoadmapChapter> = {}): RoadmapChapter {
  return {
    chapterId: "chp_00000000000000000000000001",
    title: "Variables and logic",
    category: "code",
    skills: [PYTHON],
    evidence: "none",
    claims: [],
    outcome: "Write a small program with variables and control flow.",
    resources: [],
    done: false,
    ...overrides,
  };
}

function answer(resources: Record<string, unknown>[]): string {
  return JSON.stringify({ resources });
}

function candidate(pageIndex: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const page = EXA_PAGES[pageIndex]!;
  return {
    pageIndex,
    title: pageIndex === 0 ? "Python basics course" : pageIndex === 1 ? "beginner book" : "Python Starter Practice",
    provider: "Python",
    format: pageIndex === 1 ? "book" : "course",
    cost: pageIndex === 1 ? "paid" : "free",
    level: "beginner",
    lang: "en",
    quote: page.text.split(". ")[0] + ".",
    ...overrides,
  };
}

test("findResources searches once, uses the fast model and returns quote-checked resources", async () => {
  const exa = new FakeExa(EXA_PAGES);
  const llm = new FakeLlm([answer([
    candidate(0, { scope: "variables, conditions, loops, and functions" }),
  ])]);

  const result = await findResources(chapter(), context, { exa, llm, cache: new MemoryResourceCache() });

  assert.deepEqual(exa.calls, [{
    query: "best free beginner course to learn Python for backend developer in en",
    numResults: 8,
  }]);
  assert.equal(llm.calls.length, 1);
  assert.equal(llm.calls[0]!.model, MODELS.fast);
  assert.equal(llm.calls[0]!.json, true);
  assert.equal(llm.calls[0]!.temperature, 0);
  assert.equal(result.resources.length, 1);
  const resource = result.resources[0]!;
  assert.match(resource.resourceId, /^res_/);
  assert.equal(resource.url, EXA_PAGES[0]!.url);
  assert.equal(resource.scope, "variables, conditions, loops, and functions");
  assert.match(resource.source.id, /^src_/);
  assert.equal(resource.source.tool, "exa");
  assert.equal(resource.source.quote, candidate(0).quote);
  assert.equal(resource.source.contentHash, sha256(EXA_PAGES[0]!.text));
  assert.ok(!Number.isNaN(Date.parse(resource.source.fetchedAt)));
  assert.equal(result.topPickId, resource.resourceId);
});

test("findResources drops a resource with a fabricated quote", async () => {
  const llm = new FakeLlm([answer([candidate(0, { quote: "This sentence is not on the page." })])]);

  const result = await findResources(chapter(), context, {
    exa: new FakeExa(EXA_PAGES),
    llm,
    cache: new MemoryResourceCache(),
  });

  assert.deepEqual(result, { resources: [] });
});

test("findResources stores the exact page substring after whitespace-normalised quote matching", async () => {
  const page: ExaResult = {
    url: "https://example.com/course",
    title: "Python Basics",
    text: "Python Basics course   access\nis free.",
  };
  const llm = new FakeLlm([answer([{
    pageIndex: 0,
    title: "Python Basics course",
    provider: "Python",
    format: "course",
    cost: "free",
    lang: "en",
    quote: "Python Basics course access is free.",
  }])]);

  const result = await findResources(chapter(), context, {
    exa: new FakeExa([page]),
    llm,
    cache: new MemoryResourceCache(),
  });

  assert.equal(result.resources[0]!.source.quote, "Python Basics course   access\nis free.");
});

test("findResources rejects empty zero-width quotes and ungrounded titles and providers", async () => {
  const page: ExaResult = {
    url: "https://example.com/course",
    title: "Python Basics",
    text: "Python Basics course is free.",
  };
  const llm = new FakeLlm([answer([
    {
      pageIndex: 0,
      title: "Python Basics course",
      provider: "Python",
      format: "course",
      cost: "free",
      lang: "en",
      quote: "\u200b",
    },
    {
      pageIndex: 0,
      title: "Invented Academy course",
      provider: "Invented Academy",
      format: "course",
      cost: "free",
      lang: "en",
      quote: page.text,
    },
  ])]);

  const result = await findResources(chapter(), context, {
    exa: new FakeExa([page]),
    llm,
    cache: new MemoryResourceCache(),
  });

  assert.deepEqual(result, { resources: [] });
});

test("free cost needs quote or heading support and ambiguous mixed pricing becomes freemium", async () => {
  const pages: ExaResult[] = [
    {
      url: "https://example.com/unrelated-free",
      title: "Python Basics",
      text: "Python Basics course teaches syntax. Another unrelated course is free.",
    },
    {
      url: "https://example.com/mixed",
      title: "Python Core",
      text: "Python Core course includes lessons. A free audit is available. Certificates cost EUR 20.",
    },
    {
      url: "https://example.com/free-heading",
      title: "Free Python Workshop",
      text: "Free Python Workshop\nLearn Python syntax with exercises.",
    },
  ];
  const llm = new FakeLlm([answer([
    { pageIndex: 0, title: "Python Basics course", provider: "Python", format: "course", cost: "free", lang: "en", quote: "Python Basics course teaches syntax." },
    { pageIndex: 1, title: "Python Core course", provider: "Python", format: "course", cost: "free", lang: "en", quote: "Python Core course includes lessons." },
    { pageIndex: 2, title: "Free Python Workshop", provider: "Python", format: "course", cost: "free", lang: "en", quote: "Learn Python syntax with exercises." },
  ])]);

  const result = await findResources(chapter(), context, {
    exa: new FakeExa(pages),
    llm,
    cache: new MemoryResourceCache(),
  });

  assert.deepEqual(result.resources.map(({ title, cost }) => [title, cost]), [
    ["Free Python Workshop", "free"],
    ["Python Core course", "freemium"],
  ]);
});

test("findResources ignores a model-written URL and uses the matching Exa result URL", async () => {
  const selected = candidate(0, { url: "https://attacker.example/fabricated" });
  delete selected.pageIndex;
  const llm = new FakeLlm([answer([selected])]);

  const result = await findResources(chapter(), context, {
    exa: new FakeExa(EXA_PAGES),
    llm,
    cache: new MemoryResourceCache(),
  });

  assert.equal(result.resources.length, 1);
  assert.equal(result.resources[0]!.url, EXA_PAGES[0]!.url);
  assert.equal(result.resources[0]!.source.url, EXA_PAGES[0]!.url);
});

test("findResources drops unsupported price, scope and effort metadata but keeps the resource", async () => {
  const llm = new FakeLlm([answer([candidate(1, {
    price: "EUR 99",
    scope: "Advanced deployment module",
    effortHours: 99,
  })])]);

  const result = await findResources(chapter(), context, {
    exa: new FakeExa(EXA_PAGES),
    llm,
    cache: new MemoryResourceCache(),
  });

  assert.equal(result.resources.length, 1);
  assert.equal(result.resources[0]!.cost, "paid");
  assert.ok(!("price" in result.resources[0]!));
  assert.ok(!("scope" in result.resources[0]!));
  assert.ok(!("effortHours" in result.resources[0]!));
});

test("findResources orders free before freemium before paid and prefers active free material for learn-fast", async () => {
  const pages: ExaResult[] = [
    { url: "https://example.com/paid", title: "Paid book", text: "Paid book: this Python book costs EUR 24." },
    { url: "https://example.com/free-course", title: "Free course", text: "Free course: this beginner Python course is free." },
    { url: "https://example.com/freemium", title: "Freemium videos", text: "Freemium videos use a freemium plan for Python." },
    { url: "https://example.com/free-practice", title: "Free practice", text: "Free practice: this beginner Python lab is free." },
  ];
  const llm = new FakeLlm([answer([
    { pageIndex: 0, title: "Paid book", provider: "Example", format: "book", cost: "paid", level: "beginner", lang: "en", quote: pages[0]!.text },
    { pageIndex: 1, title: "Free course", provider: "Example", format: "course", cost: "free", level: "beginner", lang: "en", quote: pages[1]!.text },
    { pageIndex: 2, title: "Freemium videos", provider: "Example", format: "video", cost: "freemium", level: "beginner", lang: "en", quote: pages[2]!.text },
    { pageIndex: 3, title: "Free practice", provider: "Example", format: "practice", cost: "free", level: "beginner", lang: "en", quote: pages[3]!.text },
  ])]);

  const result = await findResources(chapter(), context, {
    exa: new FakeExa(pages),
    llm,
    cache: new MemoryResourceCache(),
  });

  assert.deepEqual(result.resources.map(({ title, cost }) => [title, cost]), [
    ["Free course", "free"],
    ["Free practice", "free"],
    ["Freemium videos", "freemium"],
    ["Paid book", "paid"],
  ]);
  assert.equal(result.topPickId, result.resources[1]!.resourceId);
});

test("findResources cache key sorts skill URIs and a cache hit avoids another Exa or model call", async () => {
  const exa = new FakeExa(EXA_PAGES);
  const llm = new FakeLlm([answer([candidate(0)])]);
  const cache = new MemoryResourceCache();
  const first = await findResources(chapter({ skills: [SQL, PYTHON] }), context, { exa, llm, cache });
  const second = await findResources(chapter({ skills: [PYTHON, SQL] }), context, { exa, llm, cache });

  assert.deepEqual(second, first);
  assert.equal(exa.calls.length, 1);
  assert.equal(llm.calls.length, 1);
});

test("findResources uses a language- and occupation-specific foundation cache key", async () => {
  class RecordingCache implements ResourceCache {
    keys: string[] = [];
    async get(key: string): Promise<LearningResource[] | undefined> {
      this.keys.push(key);
      return [];
    }
    async set(): Promise<void> {}
  }
  const cache = new RecordingCache();

  await findResources(chapter({ title: "How the web works", skills: [] }), context, {
    exa: null,
    llm: new FakeLlm([]),
    cache,
  });

  assert.deepEqual(cache.keys, ["how-the-web-works|en|urn:stub:occupation:backend-developer"]);
});

test("findResources returns empty without calling the model when Exa is not configured", async () => {
  const llm = new FakeLlm([]);

  const result = await findResources(chapter(), context, {
    exa: null,
    llm,
    cache: new MemoryResourceCache(),
  });

  assert.deepEqual(result, { resources: [] });
  assert.equal(llm.calls.length, 0);
});

test("findResources returns empty when Exa throws", async () => {
  const exa: ExaClient = {
    async search(): Promise<ExaResult[]> {
      throw new Error("fake Exa outage containing a pretend secret");
    },
  };
  const llm = new FakeLlm([]);

  const result = await findResources(chapter(), context, {
    exa,
    llm,
    cache: new MemoryResourceCache(),
  });

  assert.deepEqual(result, { resources: [] });
  assert.equal(llm.calls.length, 0);
});

test("findResources returns empty when the model fails", async () => {
  const result = await findResources(chapter(), context, {
    exa: new FakeExa(EXA_PAGES),
    llm: new FakeLlm([]),
    cache: new MemoryResourceCache(),
  });

  assert.deepEqual(result, { resources: [] });
});

test("findResources can top-pick intermediate review material for a chapter done by evidence", async () => {
  const pages: ExaResult[] = [
    { url: "https://example.com/beginner", title: "Beginner course", text: "Beginner course: this Python course is free." },
    { url: "https://example.com/intermediate", title: "Intermediate practice", text: "Intermediate practice: this Python lab is free." },
  ];
  const llm = new FakeLlm([answer([
    { pageIndex: 0, title: pages[0]!.title, provider: "Example", format: "course", cost: "free", level: "beginner", lang: "en", quote: pages[0]!.text },
    { pageIndex: 1, title: pages[1]!.title, provider: "Example", format: "practice", cost: "free", level: "intermediate", lang: "en", quote: pages[1]!.text },
  ])]);

  const result = await findResources(chapter({ evidence: "stated", done: true, doneBy: "evidence" }), context, {
    exa: new FakeExa(pages),
    llm,
    cache: new MemoryResourceCache(),
  });

  assert.equal(result.topPickId, result.resources[1]!.resourceId);
});

test("findResources keeps supported price, scope and hour effort metadata", async () => {
  const page: ExaResult = {
    url: "https://example.com/course",
    title: "Detailed paid course",
    text: "Detailed paid course costs EUR 24 and takes 12 hours. Module A covers variables and logic.",
  };
  const llm = new FakeLlm([answer([{
    pageIndex: 0,
    title: page.title,
    provider: "Example",
    format: "course",
    cost: "paid",
    price: "EUR 24",
    level: "beginner",
    lang: "en",
    scope: "Module A covers variables and logic.",
    effortHours: 12,
    quote: page.text,
  }])]);

  const result = await findResources(chapter(), context, {
    exa: new FakeExa([page]),
    llm,
    cache: new MemoryResourceCache(),
  });

  assert.equal(result.resources[0]!.price, "EUR 24");
  assert.equal(result.resources[0]!.scope, "Module A covers variables and logic.");
  assert.equal(result.resources[0]!.effortHours, 12);
});

test("a title found only in the page's own title still counts as grounded", async () => {
  const page: ExaResult = {
    url: "https://example.com/heading-only",
    title: "Example Python Primer",
    text: "This free primer covers variables and loops.",
  };
  const llm = new FakeLlm([answer([{
    pageIndex: 0,
    title: "Example Python Primer",
    provider: "Example School",
    format: "course",
    cost: "free",
    lang: "en",
    quote: page.text,
  }])]);

  const result = await findResources(chapter(), context, { exa: new FakeExa([page]), llm, cache: new MemoryResourceCache() });

  assert.equal(result.resources.length, 1);
  assert.equal(result.resources[0]!.title, "Example Python Primer");
});
