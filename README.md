<div align="center">

<img src="prototype/brand/waymark-mark.svg" alt="Waymark logo" width="72">

# Waymark

**Evidence-backed career direction: from “I’m not sure” to a practical learning plan.**

Waymark reads the real job market for you, shows where your interests and evidence meet employer demand, and turns one chosen path into a sourced roadmap. Market claims keep their sources. Nobody gets reduced to a score.

[![CI](https://github.com/cufelix/Waymark/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/cufelix/Waymark/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Hono](https://img.shields.io/badge/Hono-4-E36002?logo=hono&logoColor=white)](https://hono.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
<br>
[![Claude via OpenRouter](https://img.shields.io/badge/LLM-Claude%20via%20OpenRouter-D97757?logo=anthropic&logoColor=white)](https://openrouter.ai/)
[![ElevenLabs voice](https://img.shields.io/badge/Voice-ElevenLabs-000000?logo=elevenlabs&logoColor=white)](https://elevenlabs.io/)
[![Tests](https://img.shields.io/badge/tests-462%20passing-B8F25B)](#tests)
[![Built at a hackathon](https://img.shields.io/badge/built%20at-Ethera%20hackathon%202026-B8F25B)](#team)

[**Landing page**](https://cufelix.github.io/Waymark/) · [**Try it locally in 2 minutes**](#try-it-locally) · [API contract](API.md) · [Architecture plan](PLAN.md)

<img src="docs/media/hero.jpg" alt="Waymark landing page: Your future isn't a guessing game" width="900">

</div>

---

## The problem

Career advice for people who don’t yet know what they want is mostly vibes: personality quizzes, generic “top 10 jobs” lists, and match percentages nobody can explain. Job ads, meanwhile, already say exactly what employers pay for, in their own words.

Waymark starts from the person, not a quiz score. It asks what they enjoy with **everyday tasks drawn from job ads**, researches the **live market** for the paths that come out of that, and builds a **learning roadmap** whose skill chapters show how many current ads ask for them.

## See it in action

<div align="center">
<img src="docs/media/demo.gif" alt="Waymark walkthrough: intake, task cards, research, career paths, roadmap and module" width="860">
<br>
<sub>Full flow in the built-in offline demo (<code>?sample=1</code>). All people, companies and URLs are fictional.</sub>
</div>

## How it works for the seeker

<table>
<tr>
<td width="50%" valign="top">

### 1 · Guided intake

Three warm-up questions, then **task cards built from what job ads actually ask people to do**: “Would you enjoy doing this?” 👎 / 🤷 / 😍. The engine picks each next card to separate the paths it is least sure about, and stops once the top three are clear. Then the practical bits: location, hours a week, course budget, education, languages, dream companies. Answer by tapping, or **talk it through** with an ElevenLabs voice.

</td>
<td width="50%"><img src="docs/media/intake-task-cards.png" alt="Task card from a job ad with three reaction buttons"></td>
</tr>
<tr>
<td width="50%"><img src="docs/media/research.png" alt="Live research feed: career paths, companies, job ads, markets, links"></td>
<td width="50%" valign="top">

### 2 · Live market research

An agent reads job boards, company pages, registries and salary sources for the seeker’s locations, plus any CV or links they chose to share. Progress streams in live. Every requirement is extracted **with a verbatim quote**; if the quote is not in the fetched page, the claim is rejected.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 3 · Up to three sourced career paths

Each path shows open roles in the selected markets, the salary ladder where job ads or salary sources provide one, companies hiring now and what the seeker already shared, with linked evidence. **No match percentage, no hiring probability.** Not convinced? “Show me 4 more tasks”.

</td>
<td width="50%"><img src="docs/media/career-paths.png" alt="Three career path cards with open roles and salaries"></td>
</tr>
<tr>
<td width="50%"><img src="docs/media/roadmap.png" alt="Isometric roadmap with learning sections and chapter tiles"></td>
<td width="50%" valign="top">

### 4 · A roadmap you can act on

The chosen path becomes prerequisite-ordered learning sections. Chapters the seeker has already evidenced start ticked. Skill chapters show how many current ads ask for the skill; every chapter says what you can build afterwards and offers a top pick plus curated resources, **free first**, shaped by the seeker’s time, budget and education.

</td>
</tr>
</table>

<details>
<summary><b>More screens</b>: practical details, “What’s this job like?”, chapter page</summary>
<br>

| Practical details | What’s this job like? | Chapter page |
|---|---|---|
| <img src="docs/media/intake-practical.png" alt="Practical details form"> | <img src="docs/media/path-details.png" alt="Career path detail modal with sourced evidence and salary ladder"> | <img src="docs/media/module.png" alt="Chapter page with outcome, demand evidence and resources"> |

</details>

## Product principles

| Principle | What it means in the code |
|---|---|
| **Claims keep their sources** | Structured market claims and skill-demand evidence carry a source with URL and fetch time, with content-addressed snapshots for research pages. Quotes from the model must occur verbatim in the fetched source text or the claim is rejected, and verified source URLs beat model-written ones. |
| **No number summarises a person** | No fit score, match %, “x of y skills” or hiring chance. Paths are ordered by employer demand and the seeker’s own reactions. Model output is guarded against score-like wording. |
| **Stated ≠ proven** | What the seeker says (interview, CV) stays *stated*. Only a public link they shared that shows the skill counts as *proven*. |
| **Only what you share** | Research works from what the seeker submits or links. No logins, cookies, captcha bypasses or paywalls. Name search is designed as a separate opt-in and is currently disabled. |
| **Your data, your call** | Consent, full export and cascade delete across all four parts; retention expiry with automatic purge; zero-retention LLM routing by default. |

## Architecture

```mermaid
flowchart TB
  UI["<b>Browser UI</b><br/>intake (tap or voice) → research feed → career paths → roadmap"]
  UI -- "/ui/api bridge · no API key in the browser" --> API

  subgraph API["One Hono API · /v1"]
    direction LR
    P1["<b>Part 1 · Seeker</b><br/>intake, interview, CV,<br/>links, consent, export"] --> P2["<b>Part 2 · Research</b><br/>pg-boss worker, agent loop,<br/>vacancies, companies, market"]
    P2 --> P3["<b>Part 3 · Validation</b><br/>employer demand beside<br/>stated / proven evidence"]
    P3 --> P4["<b>Part 4 · Roadmap</b><br/>chapters, resources,<br/>progress"]
  end

  API <--> LLM["Claude Sonnet / Haiku<br/>via OpenRouter, zero retention"]
  API <--> SRC["Job APIs · Apify · Exa · Firecrawl<br/>GLEIF · GitHub · Glassdoor"]
  API <--> VOICE["ElevenLabs<br/>speech in / out"]
  API --> DB[("PostgreSQL<br/>personal + research data")]
  API --> SNAP[("Source snapshots<br/>content-addressed")]
```

The four parts are separate modules with their own contracts ([`API.md`](API.md)) and talk to each other over HTTP, so each can be split into its own service later. In the default deployment, `ROLE=all` runs the API and the research worker in one process.

**Research run, step by step:** vacancies per target occupation and location (free job APIs first, then a job-board actor the agent learned for that country) → career paths with a salary ladder → requirements with verbatim quotes → companies (registry facts, domains, ghost-job signals) → market numbers and skill-demand trends. Seeker links are read in parallel, with an ownership check. Paid tools reserve their cost before each call and stop at monthly caps. Details: [`docs/research-service.md`](docs/research-service.md).

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 22+, TypeScript 7, `tsx` |
| API | [Hono](https://hono.dev/) on `@hono/node-server`, one versioned envelope `{ ok, data, error, meta }` |
| Jobs | [pg-boss](https://github.com/timgit/pg-boss) queue on PostgreSQL 17 |
| Validation | Zod 4 for HTTP and config schemas, plus explicit validators between the four parts and on provider responses |
| LLM | Claude Sonnet (agents, interview) and Haiku (bulk extraction) via OpenRouter, zero-data-retention routing |
| Research | Exa, Firecrawl, Apify actors, GLEIF registry, GitHub API, public job APIs |
| Voice | ElevenLabs text-to-speech and speech-to-text, browser speech as fallback |
| UI | Framework-free HTML, CSS and JS, served by the API |
| Quality | Vitest + `node --test` (462 tests), `tsc --noEmit`, GitHub Actions CI with Postgres, Dependabot, pinned lockfile |
| Deploy | Docker image + Docker Compose for Coolify |

## Try it locally

The offline demo runs without any API keys. You only need Node.js 22+ and pnpm; PostgreSQL comes from npm, no Docker required.

```bash
git clone https://github.com/cufelix/Waymark.git && cd Waymark
pnpm install --frozen-lockfile

pnpm db:local          # terminal 1: PostgreSQL on :5433 from npm binaries

# terminal 2
export DATABASE_URL=postgres://research:research@localhost:5433/research
export API_KEYS=local-dev-key UI_LOCAL=1
pnpm migrate
pnpm start
```

Then open **<http://localhost:8787/index.html?sample=1>** for the full flow with fictional data, or <http://localhost:8787/> for the live flow (which needs the provider keys below).

<details>
<summary><b>Run against the live market (provider keys)</b></summary>
<br>

Copy `.env.example` to `.env` (it is loaded automatically) and add keys. The complete live flow needs `OPENROUTER_API_KEY` (interview, research and planning) and `EXA_API_KEY` (roadmap learning resources); the others widen coverage:

| Variable | Used for |
|---|---|
| `OPENROUTER_API_KEY` | Interview turns, structured extraction and roadmap planning |
| `OPENROUTER_ZDR`, `OPENROUTER_DATA_COLLECTION` | Fail-closed provider privacy routing; defaults to zero retention and denied data collection |
| `EXA_API_KEY` | Company domains, salary sources, trends, learning resources and the task-deck generator script |
| `FIRECRAWL_API_KEY` | Reading public pages selected by the seeker |
| `APIFY_TOKEN` | Job boards per country and vetted public-data actors |
| `GITHUB_TOKEN` | GitHub API access for seeker-selected repositories |
| `ELEVENLABS_API_KEY` | Voice mode (speech in and out); browser speech is the fallback without it |
| `PERSONAL_DATA_RETENTION_DAYS` | Sliding retention for seeker-owned data; defaults to 90 days |
| `RESOURCE_CACHE_TTL_HOURS` | Maximum age of cached learning-resource evidence; defaults to seven days |

OpenRouter, Apify, Exa and Firecrawl have monthly hard caps through `CAP_LLM_USD`, `CAP_APIFY_USD`, `CAP_EXA_USD` and `CAP_FIRECRAWL_USD`; ElevenLabs has a daily character cap, `CAP_ELEVENLABS_CHARS_PER_DAY`. Keep the defaults low until a real workload has been measured. With Docker you can use `docker compose up -d db` instead of `pnpm db:local`.

The dependency policy may reject packages published too recently. Do not bypass that safeguard blindly; inspect the affected lockfile entries or wait for the release-age window.

</details>

<details>
<summary><b>Deploy on Coolify</b></summary>
<br>

1. In Coolify, create a resource from the GitHub repository, choose the Docker Compose build pack, and set the compose file to `docker-compose.coolify.yml`.
2. Set the domain on the `app` service to your public URL (for example `https://waymark.example.com`) and its port to `8787`.
3. Provide strong unique values for `POSTGRES_PASSWORD`, `API_KEYS` and `PROOF_SECRET`; set `DATABASE_URL=postgres://research:<URL-encoded POSTGRES_PASSWORD>@db:5432/research` and `UI_PUBLIC_ORIGIN` to that same public URL; then add provider keys as needed. Leave `TRUST_CLOUDFLARE=1` only while requests reach the service through Cloudflare.
4. Set Cloudflare SSL/TLS encryption mode to **Full (strict)**, and ideally put Cloudflare Access in front of the domain.

The app waits for PostgreSQL to become healthy and runs migrations before starting the API and worker. Data and source snapshots use named volumes.

**Public demo that can’t spend money:** set `UI_DEMO_ONLY=1` and leave every provider key empty. The UI bridge is then closed (the browser can’t reach any route that calls a model or provider) and every page runs on the built-in sample data. Anyone can click through the whole product; their answers never leave the browser and no paid API is called.

Without `UI_DEMO_ONLY`, this public setup is a live demo, not a multi-user production deployment: the UI bridge uses one shared server API key and there is no per-user login. Use only obviously fake data (for example “Jane Example” and `example.com`). See the [readiness audit](docs/readiness-audit.md).

</details>

## Tests

```bash
pnpm migrate   # with DATABASE_URL pointing at a local PostgreSQL
pnpm check     # Vitest + node --test + tsc --noEmit
```

On `main`, `pnpm check` passes **148 Vitest tests** (2 skipped) and **314 Node tests**, and the TypeScript build is clean. The same command runs in CI against PostgreSQL 17 on every pull request and push to `main`. The intake, validation and roadmap modules are framework-free; after `pnpm install` their tests run directly on Node without a test framework:

```bash
node --test $(git ls-files 'src/seeker/*.test.ts' 'src/seeker/**/*.test.ts' 'src/gap/*.test.ts' 'src/roadmap/*.test.ts')
```

## Repository map

| Area | Purpose |
|---|---|
| [`src/seeker/`](src/seeker) | Part 1: guided intake, interview, CV extraction, links, consent, export and delete |
| [`src/research/`](src/research) | Part 2: vacancy, company, market, trends and seeker-link research |
| [`src/agent/`](src/agent), [`src/tools/`](src/tools) | Research agent loop, learned job-board recipes and tool adapters |
| [`src/gap/`](src/gap) | Part 3: employer demand beside the seeker’s stated / proven evidence |
| [`src/roadmap/`](src/roadmap) | Part 4: target role, learning chapters, resources and progress |
| [`src/api/`](src/api) | Hono adapters that mount the four parts, the UI bridge and voice routes |
| [`src/privacy/`](src/privacy), [`src/storage/`](src/storage) | Retention and purge workers; content-addressed source snapshots |
| [`prototype/`](prototype) | Browser UI and offline sample data |
| [`landing/`](landing) | Marketing page, published to GitHub Pages |
| [`API.md`](API.md) · [`PLAN.md`](PLAN.md) | Shared HTTP and data contract · architecture, product rules and delivery plan |

## Privacy and production readiness

Waymark was built around data minimisation and traceable evidence: OpenRouter requests fail closed to zero-retention endpoints, structured logs redact sensitive fields, emails, URLs and bearer tokens, and the code avoids logging seeker content, personal data expires and is purged automatically, and failed cascade deletes retry from a durable queue.

> [!IMPORTANT]
> Waymark is a hackathon project, not a production service. Before using real personal data, close the P0 items in the [readiness audit](docs/readiness-audit.md): a human review of the task deck built from job ads, real occupation identifiers instead of stub ones, real user authentication and ownership checks instead of a shared API key, approved processors with signed agreements, encrypted backups with tested erasure, and a human evaluation of recommendation quality ([method](docs/quality-evaluation.md)).

More: [Privacy and data handling](docs/privacy-and-data.md) · [Privacy operations runbook](docs/privacy-operations-runbook.md) · [Security policy](SECURITY.md) (please report vulnerabilities privately, not in a public issue).

## Team

Built by three people at the **Ethera hackathon** in October 2026, then hardened for deployment.

| | Role | Built |
|---|---|---|
| [@cufelix](https://github.com/cufelix) | Research and platform | Research agent and job-market pipeline, company and salary research, database, workers, cost control, landing page, security hardening |
| [@Dymyt-ry](https://github.com/Dymyt-ry) | Seeker experience and roadmap | Guided intake and adaptive task cards, interview and CV reading, validation, roadmap planner, privacy controls, ElevenLabs voice integration, live UI wiring, deployment |
| [@ZachHtet](https://github.com/ZachHtet) | Design and pitch | Brand, design system, UI prototype including the voice-mode experience, isometric roadmap art, product copy |

## License

Licensed under the [Apache License 2.0](LICENSE).
