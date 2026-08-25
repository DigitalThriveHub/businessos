# Gate M — operational intelligence and management control

Gate M extends the existing BusinessOS database, API, permissions, matters,
documents, tasks, approvals and dashboard. It is not a standalone document
system, a second CRM or a replacement identity store.

## Implemented

- **My Work**: one employee-specific queue for assigned tasks, deadlines,
  approvals, customer dependencies and document reviews.
- **Document intelligence**: clean-file-only PDF, Word, spreadsheet, text and
  image classification; structured fields, dates, names, expiry suggestions,
  missing-page checks, missing-information checks and inconsistency flags.
- **Human control**: provider output is advisory. Only an authorised AAL2 human
  can accept, correct or reject it, change document classification/expiry,
  update the linked checklist item or create controlled follow-up work.
- **Durable processing**: leased jobs, hash/content-type/size revalidation,
  retries, stale-version cancellation, dead-letter evidence and safe provider
  failure messages.
- **Control Tower**: demand, conversion, open/completed matters, unassigned work,
  missing next actions, overdue/SLA/approval/document risk, team workload and
  stage distribution.
- **Operational value evidence**: append-only events and organisation-controlled
  time/cost assumptions. The UI explicitly labels the result as an estimate,
  never recognised revenue or guaranteed savings.
- Tenant RLS, permission-based views, optimistic concurrency, append-only human
  review/value evidence, audit events and server-only provider credentials.
- A compact interface with bounded queue panels, responsive overflow checks,
  retryable error states and no raw provider body or credential disclosure.

## Free mode — no AI charge

Add this only to `apps/api/.env` (never commit that file):

```dotenv
DOCUMENT_INTELLIGENCE_ENABLED=false
```

My Work, manual document review, controlled checklists, Control Tower and value
evidence still work. The worker makes no OpenAI call. Other BusinessOS features
continue normally.

After committing Gate L, apply this overlay, close manually running API/web
terminals, then run:

```powershell
Set-Location "F:\Projects\BusinessOS"

powershell -ExecutionPolicy Bypass `
  -File ".\scripts\verify-gate-m.ps1" `
  -ApplyMigration `
  -FreeMode
```

The verifier requires all 21 earlier browser scenarios plus both Gate M
scenarios to compile. With the existing AAL2 test account configured, it runs
20 non-provider scenarios and permits only the three intentionally skipped live
provider scenarios (Gate K, Gate L and Gate M).

## Live document intelligence — separately billed

Use a fresh server-only OpenAI project key that has never appeared in chat,
screenshots, terminal history or source control. Configure an approved model
that accepts the document types you intend to process:

```dotenv
DOCUMENT_SCANNER_ENABLED=true
DOCUMENT_INTELLIGENCE_ENABLED=true
OPENAI_API_KEY=sk-proj-use-a-fresh-project-key
DOCUMENT_INTELLIGENCE_MODEL=your-approved-file-capable-model
DOCUMENT_INTELLIGENCE_POLL_INTERVAL_MS=5000
DOCUMENT_INTELLIGENCE_LEASE_SECONDS=300
DOCUMENT_INTELLIGENCE_TIMEOUT_MS=60000
DOCUMENT_INTELLIGENCE_MAX_OUTPUT_TOKENS=2400
DOCUMENT_INTELLIGENCE_MAX_FILE_BYTES=20971520

# Current provider-price assumptions in minor GBP per one million tokens.
DOCUMENT_INTELLIGENCE_INPUT_COST_PER_MILLION_MINOR=REPLACE
DOCUMENT_INTELLIGENCE_OUTPUT_COST_PER_MILLION_MINOR=REPLACE
```

Gate M uses the OpenAI Responses API with `store: false` and strict structured
output. Provider use is not free and BusinessOS does not falsely label a real API
call as free. Official file-input guidance:
https://developers.openai.com/api/docs/guides/file-inputs

Before live acceptance, use the existing matter workspace to upload a harmless,
dedicated test document with a unique title. Let the existing ClamAV worker mark
it clean. Put the exact title and the existing AAL2 test account in
`apps/web/.env.local`:

```dotenv
E2E_CASE_USER_EMAIL=your-controlled-test-user
E2E_CASE_USER_PASSWORD=REPLACE
E2E_CASE_USER_TOTP_SECRET=REPLACE_BASE32
E2E_GATE_M_DOCUMENT_TITLE=Gate M acceptance 20260825-unique
```

Then close manually running API/web terminals and run:

```powershell
powershell -ExecutionPolicy Bypass `
  -File ".\scripts\verify-gate-m.ps1" `
  -ApplyMigration `
  -RequireLiveGateM
```

The strict run verifies the migration, all API tests/builds, all web
lint/builds, the full non-provider browser regression, browser-secret absence,
one real clean-file provider result, AAL2 review availability and cross-tenant
rejection. It does not auto-approve or alter the dedicated document.

## Honest boundary

Passing Gate M is not the same as declaring the whole product production-ready.
The final Gate N still must prove UK GDPR operational workflows, production
hosting/monitoring/secrets, backup restoration, disaster recovery, load and
failure behaviour, all live-provider journeys, accessibility/user acceptance
and an independent penetration test with remediation. Those outcomes require
the real production environment and cannot be manufactured by unit tests.

Before customer documents are sent to any AI provider, the UK controller must
approve the processing purpose, data minimisation, retention, processor terms,
international-transfer position, access controls and DPIA decision. Keep Gate M
in free mode until that review is complete.

## Recovery

The installer creates a recoverable source backup in Downloads before replacing
files. Database changes are intentionally forward-only because review and value
evidence are audit records. To pause live analysis, set
`DOCUMENT_INTELLIGENCE_ENABLED=false`, redeploy, retain the Gate M tables and
diagnose before a reviewed forward migration.
