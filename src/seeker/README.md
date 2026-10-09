# Part 1: User input (`src/seeker/`)

Owner: @Dymyt-ry. Contract: `API.md` → “Part 1: User input”.

Framework-free TypeScript run directly by modern Node type stripping, so:
- imports use the `.ts` extension;
- no `enum`, no `namespace`, no constructor parameter properties (type stripping can't erase them);
- tests use `node:test` + `node:assert/strict` and never call the network.

`api.ts` exposes one framework-free `handle()`. `src/api/part1.ts` mounts it into the shared Hono server.

## Main areas

| Path | What |
|---|---|
| `contracts.ts`, `core/` | Shared Part 1 types, validation, IDs, errors and profile rules |
| `intake/` | Guided warm-up, task-card deck/engine, practical details and final chat |
| `service/seekers.ts`, `service/gdpr.ts`, `api.ts` | Seeker lifecycle, export/delete and request handling |
| `service/interview.ts`, `service/interview.prompts.ts` | Interview turns, preference draft and stated skills |
| `service/documents.ts`, `cv/extract.ts` | CV/document upload and extraction |
| `salary/` | Source-checked salary lookup |
| `store/` | Store interface and current in-memory implementation |

Tests live next to the file they test (`service/interview.test.ts`).

## Rules

- Every call to an LLM goes through `LlmClient` (`llm/llm.ts`); tests use `FakeLlm`, never the network.
- Every stored record goes through `SeekerStore`; everything is scoped by `seekerId`.
- Seeker skills are always `tier: "stated"` with a `seeker-upload://` or `seeker-interview://` source (`core/claims.ts`). Never "proven" in Part 1.
- No single score, match percentage or ranking of a person anywhere.
- Secrets come from environment variables. The shared server injects `API_KEYS`; standalone Part 1 tests/tools may pass keys directly or use `SEEKER_API_KEYS`.
- After changing a profile, always `touch()` it (`core/profile.ts`): version +1, `updatedAt`, status. Merge stated skills with `mergeStatedSkills()`, remove a document's or turn's evidence with `removeSources()`.
