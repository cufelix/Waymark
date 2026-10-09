# Product and production readiness audit

Audit date: 2026-10-09
Scope: current `main` after guided intake PR #22 plus the privacy-routing hardening on this branch
Method: code and contract review, local framework-free tests, dependency lockfile scan and review of official privacy guidance. No paid/live provider calls were made.

## Executive verdict

Waymark has unusually strong provenance guardrails for a prototype: source-linked market facts, verbatim quote checks, bounded model output, strict input validation, seeker-controlled progress and a deliberate ban on personalised fit scores or hiring probabilities.

It is not ready for real personal data or public GDPR-compliance claims. The recommendation layer is still using a fake intake deck, output quality has only synthetic evaluation, and the deployment lacks user authentication, verified processor governance, backup-erasure evidence and operational privacy documentation.

## What is already strong

### Data and evidence

- Market and learning-resource facts retain sources, hashes and fetched timestamps.
- Fabricated or non-verbatim supporting quotes are rejected.
- Vacancy demand and seeker evidence remain separate concepts.
- Uploaded/interview evidence stays `stated`; a selected public link can provide stronger evidence only after ownership and source checks.
- Public readers explicitly avoid logins, cookies, captcha bypass and paywalled content.

### Recommendations

- Guided cards ask about concrete work rather than job-title prestige.
- The current card hides its occupation until rating.
- Path order comes from the seeker’s own card ratings; the public result has no score field.
- Validation reports employer demand beside `proven`, `stated` or `none` evidence without turning it into a fit percentage.
- Career-path and salary claims keep source material.

### Roadmaps

- Chapters are constrained to skills present in the validation catalog.
- Missing high-demand skills get a deterministic fallback chapter instead of silently disappearing.
- Time, course budget and education are included in planning context.
- Resource URLs come from search results, not model output, and labels/quotes/cost signals are checked against page content.
- Known skills can start as done-by-evidence while remaining editable by the seeker.

### Reliability and privacy foundations

- 294 framework-free tests pass on current main.
- Cross-seeker isolation, validation, cascade sequencing and many failure modes have regression tests.
- Provider errors are sanitized at the API boundary.
- Deletion begins by hiding the seeker as deletion-pending.

## P0 — block real users and strong public claims

| Finding | Why it matters | Exit condition |
|---|---|---|
| Intake uses `fake-0`, `example.com` sources and eight stub occupations | Career directions are not based on real local employer demand | Build, review and version a real deck; replace stub occupation IDs; add coverage/freshness metrics |
| One shared bearer key authorizes every seeker route | A valid caller can access any known seeker ID | Add real user identity and ownership checks to every user-owned object |
| Request-level OpenRouter privacy routing is enforced, but approved endpoints and processing governance are absent | Zero-retention routing reduces provider storage but does not establish lawful processing, transfer safeguards or an approved provider chain | Enforce the policy at account level, allow-list reviewed providers/regions, and complete DPA/transfer assessment and endpoint verification |

### Closed on this branch

- OpenRouter requests require zero-retention endpoints and deny provider data collection by default, with payload tests.
- The dependency lockfile passes the configured minimum-release-age policy and installs reproducibly with `pnpm install --frozen-lockfile`.
- The unused `mammoth` dependency was removed; vulnerable `axios` and `basic-ftp` transitive paths were overridden to fixed versions. A fresh OSV lockfile scan reports no known vulnerabilities.
- CI now runs database migrations, Vitest, all framework-free Node tests and strict typechecking against PostgreSQL 17.
- Apache-2.0 is selected and included in the repository.
- Parts 1, 3 and 4 now use transactional PostgreSQL stores; restart persistence and atomic roadmap replacement are integration-tested.
- Complete research exports include original profile/options, artifacts and ledger rows; research deletion now cascades to ledger rows.
- Primary personal data uses a configurable 90-day default retention period with immediate expiry hiding and automatic snapshot-aware purge.
- Failed cascade deletion is stored in PostgreSQL and retried automatically after restarts with bounded backoff.
- Structured logging now redacts common sensitive fields, URLs, email addresses and raw exception messages, with regression tests.

## P1 — quality and operational hardening

### Recommendation quality

- All recommendation tests use synthetic fixtures; there is no blinded human evaluation or outcome dataset.
- The deck covers only eight broad paths and one country fallback. Unknown countries silently receive the CZ deck.
- The weighting system and stopping threshold are deterministic but not calibrated against user understanding or later choices.
- “Top three” expresses preference over shown tasks, not ability, suitability or labour-market opportunity; UI copy must preserve that distinction.
- Career-path research needs coverage measures: vacancies found, source diversity, duplicate rate, stale pages and occupation taxonomy resolution.

Recommended evaluation set: at least 20 consented/internal personas spanning undecided, career-change and direct-role cases; two human reviewers; expected acceptable path set rather than one “correct” answer; track unsupported claims, missed constraints, source validity and stability across repeated runs.

### Roadmap quality

- Current e2e output is constructed from deterministic fake model/search responses, so it proves plumbing and guards, not pedagogical quality.
- Resource ranking is primarily free-first plus result order/format preference; it does not measure teaching quality, prerequisites, accessibility, recency or completion outcomes.
- There is no live dead-link checker; cache expiry limits how long stale evidence can be reused but does not prove a page remains available between refreshes.
- Resource search falls back through the seeker's languages, but the profile still has no dedicated learning-language preference.
- There is no end-to-end live evaluation of whether the proposed sequence fits the available weekly hours.

The repeatable benchmark and acceptance thresholds are in [Quality evaluation](quality-evaluation.md). It still needs reviewed real data and human results before any quality claim.

### Closed roadmap reliability items on this branch

- Configured resource-provider failures now fail the build instead of producing a misleading ready roadmap; unfinished chapters require a verified resource.
- Cached resource evidence has a configurable seven-day default TTL.
- Searches try the seeker's next language when the preceding language returns no pages.
- Tracking-normalized duplicate URLs are removed across chapters when an alternative keeps the chapter actionable, and top picks are recalculated afterwards.

### Privacy operations

- Snapshot files are not encrypted by the application and backup deletion is undefined.
- Consent has a version/timestamp but there is no repository privacy notice to bind that version to.
- Correction, restriction, objection and operational request tracking are not implemented.
- A deployment runbook now covers requests, backup erasure, incidents and processor approval, but named owners, exercises, a ROPA and a DPIA decision remain operator work.

## P2 — polish after the gates

- Add screenshots or a short product walkthrough once the UI/API bridge is integrated.
- Add architecture decision records for evidence tiers, no-score policy, processor routing and retention.
- Add observability for source freshness, deletion jobs, provider failures and cost without logging seeker content.
- Expand localization and country-specific decks only after each one has reviewed sources.

## Suggested work order

1. User authentication and ownership authorization.
2. Processor allow-list, account-level ZDR enforcement, transfer assessment and deployer privacy notice.
3. Backup encryption, restore testing and backup-erasure procedure.
4. Real CZ intake deck and human recommendation evaluation.
5. Live roadmap quality benchmark and resource freshness checks.
6. Public screenshots and a product walkthrough.
