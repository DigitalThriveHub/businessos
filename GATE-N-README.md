# Gate N — UK compliance and production assurance

Gate N is the final consolidated engineering gate. It extends the existing
BusinessOS database, API, roles, audit trail, workspaces and deployment controls.
It is not a standalone compliance product, second CRM or substitute for legal,
security or certification professionals.

## Delivered in this overlay

- Data-subject access, correction, erasure, restriction, portability, objection
  and automated-decision-review case management, with identity evidence,
  versioned transitions, a controlled one-time complexity extension with notice
  evidence, and a human-reviewed export candidate.
- Privacy-incident and personal-data-breach register with a 72-hour clock,
  containment/risk/notification evidence and immutable event history.
- Organisation, client, matter and document legal holds; retention policies and
  reviews; and hard blocking of archive/anonymise/delete decisions while a hold
  applies. Gate N records disposition evidence but never performs silent bulk
  deletion.
- Twelve mandatory launch controls: restore, independent penetration test,
  vulnerability scanning, load/failure testing, incident exercise, DPIA, ROPA,
  processor review, accessibility, UK pilot, live providers and monitoring.
- SHA-256-bound evidence, expiry, a different AAL2 reviewer, and a third-person
  release decision for the critical restore, penetration-test and pilot controls.
- A production release cannot be approved while evidence is missing, failed or
  expired; serious incidents, unresolved breach decisions, overdue rights or
  retention reviews, pilot gaps and high defects also block it.
- Tenant RLS, permission-specific reads, server-only mutations, optimistic
  concurrency, append-only event/release records, audit events and no-store BFF
  responses.
- Compact Assurance centre UI, complete API error mapping, 17 new API tests,
  ordered execution of every migration, 25 compiled browser scenarios, CI,
  CodeQL, dependency updates and repeatable production-safe verification.

## Install

Apply the overlay only to the same BusinessOS repository used for Gates K–M.
The installer creates a recoverable source backup and never writes credentials
or applies the migration.

Then close API/web terminals and run the free/non-provider verification:

```powershell
Set-Location "F:\Projects\BusinessOS"

powershell -ExecutionPolicy Bypass `
  -File ".\scripts\verify-gate-n.ps1" `
  -ApplyMigration `
  -FreeMode
```

Free mode disables paid AI and live communication provider calls during the
browser run. All ordinary CRM, finance, workflow, portal, compliance, retention,
approval, reporting and manual document operations remain available.

Expected browser result with the existing case account and no dedicated MFA
enrolment account: **20 passed, 5 intentional skips**. If the dedicated MFA
fixture is configured: **21 passed, 4 intentional provider skips**. Any other
skip or any failure is rejected.

## Production-evidence run

Do not run this merely to make a green badge. First obtain and record real,
current evidence in **Assurance → Release evidence**. Evidence must be reviewed
by a different AAL2 user. The final approver must be different from the reviewer
of the restore, penetration-test and UK-pilot evidence.

Use fresh server-only provider credentials stored in the deployment secret
manager. A previously exposed OpenAI key must be revoked, not reused.

When every live provider and external control is genuinely ready:

```powershell
Set-Location "F:\Projects\BusinessOS"

powershell -ExecutionPolicy Bypass `
  -File ".\scripts\verify-gate-n.ps1" `
  -ApplyMigration `
  -RequireProductionEvidence `
  -ApiOrigin "https://api.your-domain.co.uk/" `
  -WebOrigin "https://app.your-domain.co.uk/"
```

This strict run permits zero skipped browser scenarios and performs safe live
health/security-header/capacity probes. It still does not manufacture an ISO
certificate, penetration-test report, legal opinion, restored backup or user
acceptance result. Those must be supplied by the responsible independent party.

## Honest completion boundary

After the free verification passes, the **software implementation is complete
for local/staging evaluation**, but the system is not yet customer-live or
“bank-grade certified.” Customer launch is permitted only when the Assurance
centre has no blockers, the strict production-evidence run passes, an authorised
person records the immutable approval, and the organisation accepts the residual
risk. See `docs/GATE-N-UK-COMPLIANCE-PRODUCTION-ASSURANCE.md`.
