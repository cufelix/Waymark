# Part 1: User input (`src/seeker/`)

Owner: @Dymyt-ry. Contract: `API.md` → "Part 1: User input" (on branch `cufelix/implementation-plan`, read it with `git show origin/cufelix/implementation-plan:API.md`).

Framework-free TypeScript, **zero npm dependencies** until @cufelix lands `package.json`. Node 26 runs `.ts` directly (type stripping), so:
- imports use the `.ts` extension;
- no `enum`, no `namespace`, no constructor parameter properties (type stripping can't erase them);
- tests: `node --test 'src/seeker/**/*.test.ts'` (`node:test` + `node:assert/strict`). `src/seeker/package.json` only sets `"type": "module"`; it has no dependencies and goes away when the root `package.json` lands.

Next.js routes get wired once the skeleton exists. `api.ts` exposes one framework-free `handle()` so each route is a thin wrapper.

## Files and owners (one owner per file)

| Path | Owner | What |
|---|---|---|
| `contracts.ts`, `core/ids.ts`, `core/errors.ts`, `core/claims.ts`, `core/profile.ts`, `llm/llm.ts`, `store/store.ts`, `store/memory.ts`, `taxonomy.ts` | base (`Dymyt-ry/part1-base`) | shared; change only through the base branch |
| `core/validate.ts`, `core/auth.ts`, `service/seekers.ts`, `service/gdpr.ts`, `api.ts`, `fixtures/profiles/` | `Dymyt-ry/part1-core` | create seeker, preferences, links, profile handoff, export/delete, request handling |
| `service/interview.ts`, `service/interview.prompts.ts` | `Dymyt-ry/part1-interview` | interview turns via OpenRouter, preferences draft, stated skills from answers |
| `service/documents.ts`, `cv/extract.ts` | `Dymyt-ry/part1-cv` | CV upload (PDF/DOCX), parse into stated skills, experience, education; delete |

Tests live next to the file they test (`service/interview.test.ts`).

## Rules

- Every call to an LLM goes through `LlmClient` (`llm/llm.ts`); tests use `FakeLlm`, never the network.
- Every stored record goes through `SeekerStore`; everything is scoped by `seekerId`.
- Seeker skills are always `tier: "stated"` with a `seeker-upload://` or `seeker-interview://` source (`core/claims.ts`). Never "proven" in Part 1.
- No single score, match percentage or ranking of a person anywhere.
- Secrets only from env (`OPENROUTER_API_KEY`, `SEEKER_API_KEYS`); `.env*` is gitignored.
- After changing a profile, always `touch()` it (`core/profile.ts`): version +1, `updatedAt`, status. Merge stated skills with `mergeStatedSkills()`, remove a document's or turn's evidence with `removeSources()`.
