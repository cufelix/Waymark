# Research service (Part 2)

Owner: @cufelix. Contract: [`API.md`](../API.md), Part 2. Design: [`user-research.md`](user-research.md).

## Run it

```bash
pnpm install
cp .env.example .env            # then fill in the keys below
pnpm db:local                   # Postgres on 5433 from npm binaries (or: docker compose up -d db, with POSTGRES_PASSWORD set)
pnpm migrate
pnpm start                      # API on :8787 plus the worker (ROLE=api or ROLE=worker to split them)
```

| Key | Unlocks | Without it |
|---|---|---|
| `OPENROUTER_API_KEY` | every agent loop and extraction (Claude Sonnet for agents, Haiku for bulk work) | nothing works |
| `APIFY_TOKEN` | job boards per country (learned actor), social platforms (TikTok, SoundCloud, Instagram…) | free job APIs only, no social links |
| `EXA_API_KEY` | company domains, then-vs-now trends, salary sites, fallback page reading | no trends, fewer salaries |
| `FIRECRAWL_API_KEY` | JavaScript-heavy sites and portfolios | plain fetch only |
| `GITHUB_TOKEN` | 5,000 GitHub API calls an hour instead of 60 | rate limits sooner |

Monthly hard caps per paid tool: `CAP_*_USD`. Every paid call reserves its cost first and settles the real amount after.

## Try it

```bash
pnpm exec tsx scripts/live-run.ts test/api/fixtures/nurse.json --max 20      # in-process run with a summary
K=dev-key-change-me
curl -s -X POST localhost:8787/v1/research-runs -H "Authorization: Bearer $K" -H 'Content-Type: application/json' \
  -d "{\"profile\": $(cat test/api/fixtures/musician.json), \"options\": {\"maxVacancies\": 20}}"
curl -s localhost:8787/v1/research-runs/<runId> -H "Authorization: Bearer $K"                 # status, progress, cost
curl -s localhost:8787/v1/research-runs/<runId>/career-paths -H "Authorization: Bearer $K"    # available mid-run
# also: /companies /vacancies /market /trends /seeker-research, GDPR: DELETE /v1/seekers/<id>/research
```

Fixtures: `junior-backend`, `musician`, `nurse` (Berlin), `electrician` (Prague).

## How a run works

1. **Vacancies** per target occupation and location: free job APIs, then a job-board actor the agent learned for that country (a recipe), searched with the titles employers there actually use, plus a Senior/Lead search for the upper ladder steps.
2. **Career paths** with a **ladder** per path (levels, titles, experience, pay from ads or a salary site), published at once.
3. **Requirements** from each ad, only with verbatim quotes.
4. **Companies**: registry facts (GLEIF), domains (Exa), ghost-job signals from our own history.
5. **Market** numbers, then **trends**: skill demand ~10 years ago vs now.
6. In parallel, **seeker research**: every link is read by recipe or, when new, by an agent that learns one; ownership check; skills only with verbatim quotes.

Tests: `pnpm test` (Part 2, vitest) and `node --test 'src/seeker/**/*.test.ts'` (Part 1).
