# Privacy operations runbook

This is a deployment template, not evidence that an operator has completed these controls. Before accepting real data, replace every `<owner>` and `<system>` placeholder, test each procedure in the deployed environment and retain dated evidence.

## Ownership and records

| Responsibility | Named owner | Evidence to retain |
|---|---|---|
| Data controller and privacy contact | `<owner>` | published notice and contact route |
| Security incident lead and deputy | `<owner>` | exercise record and call tree |
| Data-subject requests | `<owner>` | request register without request contents in general logs |
| Processor approval and transfer review | `<owner>` | signed agreement, subprocessor list and assessment |
| Database, snapshot and backup operations | `<owner>` | restore and erasure test records |

Keep a processing record covering purpose, data categories, recipients, locations, retention, safeguards and the responsible owner for every row in the data map. Review access and processors at least quarterly and after material architecture changes.

## Data-subject request procedure

1. Record receipt in a restricted request register and assign a case ID.
2. Verify the requester proportionately; do not collect identity documents unless necessary.
3. Locate the seeker by the authenticated ownership mapping, never by a user-supplied seeker ID alone.
4. For access or portability, call the complete export and review it for another person's data before release.
5. For correction, update the source profile, increment its version and rerun or clearly mark derived results stale.
6. For restriction or objection, stop queued and new processing before assessing what data must be retained.
7. For erasure, invoke cascade deletion, monitor the durable retry job, verify primary rows and snapshots are gone, then apply the documented backup-expiry procedure.
8. Record the decision, completion time, systems checked and reviewer. Keep request content out of application logs.

Escalate legal questions to the operator's privacy adviser. The repository does not decide identity requirements, exceptions to erasure or the legal basis for a deployment.

## Backup, restore and erasure procedure

Before launch, document `<database backup system>`, `<snapshot backup system>`, regions, encryption keys, access roles, backup frequency and maximum retention. Application retention does not erase an independent backup.

For every release environment:

1. encrypt database, snapshot storage and backups in transit and at rest with operator-controlled access;
2. prohibit personal data from ad-hoc developer archives and local dumps;
3. test a restore into an isolated environment using synthetic data;
4. verify restored access controls before any application connection;
5. ensure expired backups are automatically destroyed and record the provider evidence;
6. document whether individual deletion inside immutable backups is possible; if not, isolate the backup, prevent ordinary use and ensure the deletion is reapplied immediately after any restore;
7. test that snapshot reference counting does not retain an unreferenced seeker file;
8. record recovery point, recovery time, deletion behaviour and cleanup of the restore environment.

## Incident procedure

1. Contain: revoke exposed credentials, isolate affected services and preserve relevant evidence without copying unnecessary personal data.
2. Scope: identify data categories, people, time range, recipients, regions and whether confidentiality, integrity or availability was affected.
3. Remediate: close the access path, rotate secrets, invalidate sessions and verify deletion/retry workers and provider routing.
4. Assess notifications with the controller's privacy and legal owners under the laws applicable to the deployment.
5. Communicate using verified contact routes; do not put incident details or personal data in public issues.
6. Recover from a known-good state, monitor recurrence and record corrective actions.
7. Run a tabletop exercise before launch and after major identity, provider, storage or networking changes.

## Processor approval record

Complete one row per external service and keep the supporting documents outside the public repository.

| Service | Purpose and data | Region/transfer | Retention and training controls | Agreement/subprocessors | Approved by/date |
|---|---|---|---|---|---|
| OpenRouter and selected model endpoint | `<complete>` | `<complete>` | request controls plus verified account policy | `<complete>` | `<complete>` |
| Exa | `<complete>` | `<complete>` | `<complete>` | `<complete>` | `<complete>` |
| Firecrawl | `<complete>` | `<complete>` | `<complete>` | `<complete>` | `<complete>` |
| Apify and each approved actor | `<complete>` | `<complete>` | `<complete>` | `<complete>` | `<complete>` |
| Hosting, database and backup providers | `<complete>` | `<complete>` | `<complete>` | `<complete>` | `<complete>` |

Disable any service whose review is incomplete. Request-level routing flags are a technical control, not a substitute for the processor review.

## Launch evidence

- completed controller/contact and processor records;
- published, deployment-specific privacy notice tied to the stored policy version;
- identity and per-seeker authorization test report;
- export, correction, restriction and deletion exercise;
- retention purge and failed-deletion retry evidence;
- backup restore, expiry and post-restore deletion exercise;
- incident tabletop and secret-rotation exercise;
- current dependency and secret scans;
- DPIA decision and processing record approved by the operator.
