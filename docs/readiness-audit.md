# Product and production readiness audit

Audit date: 2026-10-09
Scope: current `main` after guided intake PR #22 plus the privacy-routing hardening on this branch
Method: code and contract review, local framework-free tests, dependency lockfile scan and review of official privacy guidance. No paid/live provider calls were made.

## Executive verdict

Waymark has unusually strong provenance guardrails for a prototype: source-linked market facts, verbatim quote checks, bounded model output, strict input validation, seeker-controlled progress and a deliberate ban on personalised fit scores or hiring probabilities.

It is not ready for real personal data or public GDPR-compliance claims. The recommendation layer is still using a fake intake deck, output quality has only synthetic evaluation, three product parts are volatile in-memory services, export is incomplete relative to stored data, and the deployment lacks user authentication, retention and verified processor governance.

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
| Part 1, validation and roadmap stores are in memory | Restarts lose access, export and deletion state while Postgres/snapshots can remain | Implement transactional Postgres stores and restart/retry tests |
| One shared bearer key authorizes every seeker route | A valid caller can access any known seeker ID | Add real user identity and ownership checks to every user-owned object |
| Export omits stored run profile/options and artifact content | “Everything stored” is false; access/portability is incomplete | Inventory every store and add complete, tested export representations |
| No retention policy or automatic purge | Storage limitation is not implemented | Define retention per data class and add scheduled, observable deletion |
| Request-level OpenRouter privacy routing is enforced, but approved endpoints and processing governance are absent | Zero-retention routing reduces provider storage but does not establish lawful processing, transfer safeguards or an approved provider chain | Enforce the policy at account level, allow-list reviewed providers/regions, and complete DPA/transfer assessment and endpoint verification |
| Dependency install is not currently reproducible under policy | CI/build cannot be trusted | Resolve recent-package policy gate, use frozen pnpm install and add CI |
| Lockfile scan reports 14 known vulnerabilities in 3 transitive packages | 8 are high severity; release hygiene is not acceptable | Upgrade/override affected chains, retest, scan clean or document accepted unreachable risk |

Affected lockfile packages at audit time:

- `axios@1.18.0` through `firecrawl@4.30.1` (fixed version reported by OSV: 1.20.0)
- `basic-ftp@5.3.1` through `get-uri`/proxy tooling (fixed version reported by OSV: 6.2.1)
- `sprintf-js@1.0.3` through `mammoth` → `argparse` (no fixed version reported for that chain)

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
- Search failures can yield a ready roadmap with empty resource lists.
- Resource cache has no TTL or freshness revalidation.
- There is no cross-chapter deduplication or dead-link checker.
- Language selection uses the first seeker language, which may not be the desired learning language.
- There is no end-to-end live evaluation of whether the proposed sequence fits the available weekly hours.

Recommended rubric per roadmap: prerequisite correctness, coverage of high-demand missing skills, realistic scope for weekly hours, no teaching of already-known material, resource availability/cost accuracy, source freshness, language fit and actionability of every chapter outcome.

### Privacy operations

- Cascade deletion retries only when the caller calls delete again; there is no durable retry job.
- Deletion-pending lives in memory and is lost on restart.
- Snapshot files are not encrypted by the application and backup deletion is undefined.
- Logs avoid expected seeker content, but error strings from reader/provider failures need systematic redaction tests.
- Consent has a version/timestamp but there is no repository privacy notice to bind that version to.
- Correction, restriction, objection and operational request tracking are not implemented.
- There is no incident runbook, access review, ROPA or DPIA decision record.

## P2 — polish after the gates

- Add stable CI and only then show a live build badge.
- Choose a license intentionally; public visibility alone does not grant reuse rights.
- Add screenshots or a short product walkthrough once the UI/API bridge is integrated.
- Add architecture decision records for evidence tiers, no-score policy, processor routing and retention.
- Add observability for source freshness, deletion jobs, provider failures and cost without logging seeker content.
- Expand localization and country-specific decks only after each one has reviewed sources.

## Suggested work order

1. Dependency/security cleanup and reproducible CI.
2. Postgres stores for Parts 1/3/4 plus durable deletion jobs.
3. User authentication and ownership authorization.
4. Complete data inventory, export and retention implementation.
5. Processor allow-list, account-level ZDR enforcement, transfer assessment and deployer privacy notice.
6. Real CZ intake deck and human recommendation evaluation.
7. Live roadmap quality benchmark and resource freshness checks.
8. Public screenshots, status badges and chosen license.
