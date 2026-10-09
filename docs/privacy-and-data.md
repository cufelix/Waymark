# Privacy and data handling

This document describes the current implementation and the work required before a real deployment. It is not a privacy notice, legal advice or a certification of compliance.

## Product principle

Waymark should answer a narrow question: what career directions and learning steps are supported by information the seeker chose to provide and by sourced employer demand?

That leads to four defaults:

1. collect only data needed for that purpose;
2. keep provenance for market facts and seeker evidence;
3. do not research a person beyond links they chose, except a separate name-search opt-in;
4. make access, export and deletion part of the product, not a support-only process.

These defaults align with the GDPR principles of purpose limitation, data minimisation, storage limitation, integrity/confidentiality and accountability. Alignment with principles does not by itself make a deployment compliant.

## Data map

| Data | Why it is used | Current storage | External recipients |
|---|---|---|---|
| Intake answers and preferences | Choose directions and shape the roadmap | Part 1 memory store | OpenRouter for free-text handling |
| CV text and extracted history | Record seeker-stated evidence | Part 1 memory store | OpenRouter for PDF/image transcription and structured extraction |
| Seeker-selected links | Verify public evidence the seeker chose to share | Postgres artifacts and disk snapshots | The linked site; potentially Firecrawl, Apify, Exa or GitHub |
| Research-run profile copy | Reproduce and process one market run | Postgres `research_runs.profile` | Research providers used by that run |
| Vacancies and company facts | Describe employer demand | PostgreSQL and source snapshots | Apify, Exa, Firecrawl, registries and public sites |
| Validations and roadmaps | Show demand/evidence and learning steps | In-memory stores | OpenRouter and Exa for planning/resources |
| Cost metadata | Enforce budgets | PostgreSQL `cost_ledger` | No application recipient |

OpenRouter routes requests to model providers with provider-specific data practices. Its own documentation exposes provider controls for zero data retention and denial of data collection; the current code does not enforce those routing fields. Account settings, provider selection and contracts therefore materially change the privacy posture.

## Controls already present

- Consent is required when a seeker record is created and carries a policy version and timestamp.
- Name search requires both profile consent and a per-run option. It is currently skipped because the profile has no name field.
- Public-page tooling rejects credentials, cookies and login-oriented actor input.
- Claims and resources use source URLs, timestamps and hashes; important generated quotes must match source text.
- The API offers a machine-readable export and a cascade delete across the four product parts.
- A failed cascade marks the seeker deletion-pending so ordinary reads stop immediately.
- Snapshots are content-addressed; deletion keeps a shared file only when another run still references it.
- Unexpected provider response bodies and stack traces are not returned to clients.
- Secrets are expected through environment variables rather than committed files.

## Production blockers

### Identity and access

The current bearer key is shared across callers and is not bound to a seeker. Anyone holding a valid key can address another seeker ID. Production needs user authentication, authorization on every seeker-owned object, session management and an auditable privileged-access path.

### Persistence and deletion durability

Parts 1, 3 and 4 use process memory. A restart loses the seeker record, deletion-pending state, validations and roadmaps while Postgres research rows and disk snapshots may remain. This can orphan personal data and make later access/deletion impossible. Persistent stores and idempotent background deletion are required.

### Export completeness

The endpoint claims to export everything stored, but Part 2 stores more than its public `ResearchRun` response: the full input profile, run options and artifact records with extracted text/metadata. Those representations are deleted by the cascade but are not currently included in the export. The export contract and tests must cover every personal-data store.

### Retention

There is no documented retention period, automatic expiry or scheduled purge for seeker data, research runs, snapshots, cost metadata, logs or backups. Define retention by data class, expose it in the privacy notice and test deletion from primary storage and backups.

### External processors and transfers

Before production, document the controller, purposes and legal bases; list processors and subprocessors; execute appropriate processing agreements; determine international-transfer safeguards; and restrict routing to approved providers/regions. For OpenRouter, enforce zero-retention and data-collection controls at the account and/or request layer and verify that the selected model endpoints support them.

### Security operations

The code has no production incident runbook, breach-notification workflow, access review, backup/restore procedure or tested secret-rotation process. Disk snapshots and Postgres encryption depend on the deployment environment and are not enforced by the repository.

## Data-subject request checklist

A production operator should be able to:

- verify the requester without collecting excessive new data;
- provide access and a machine-readable export of every stored representation;
- correct inaccurate profile data and propagate the new profile version;
- restrict processing while preserving only what the restriction permits;
- delete all user-owned rows, queued work, snapshots, caches, logs where applicable and backups under the retention policy;
- record request receipt, decision and completion without putting request contents in general logs;
- respond without undue delay and normally within one month.

## Deployment gate

Before accepting real data, record evidence for each item:

- [ ] named controller and privacy contact
- [ ] published privacy notice with purposes, legal bases, recipients, transfers and retention
- [ ] persistent Part 1/3/4 stores and per-user authorization
- [ ] complete access/export, correction, restriction and deletion flows
- [ ] automatic retention and deletion-retry jobs
- [ ] processor agreements, subprocessor register and transfer assessment
- [ ] approved OpenRouter provider list with zero-retention/data-collection controls
- [ ] encryption, backups, restore and backup-erasure procedure
- [ ] DPIA decision and record of processing activities
- [ ] incident response and breach-notification process
- [ ] dependency, secret and access reviews in CI/operations

## Authoritative references

- [European Commission — GDPR principles](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/principles-gdpr_en)
- [European Commission — controllers and processors](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/application-gdpr_en)
- [European Commission — handling data-subject requests](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/dealing-requests-individuals_en)
- [European Commission — organisational obligations and breaches](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/obligations_en)
- [OpenRouter — privacy policy](https://openrouter.ai/privacy)
- [OpenRouter — privacy guardrails](https://openrouter.ai/docs/guides/features/guardrails/overview)

