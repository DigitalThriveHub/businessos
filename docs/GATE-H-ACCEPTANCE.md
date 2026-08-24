# Gate H acceptance: universal intake and communication matching

Gate H is accepted only when `scripts/verify-gate-h.ps1` completes without a
skip. Passing compilation alone is not acceptance.

## Automated evidence

- All API suites pass and the API production build succeeds.
- Prisma formats, validates and generates against the locked schema.
- The web workspace lints and produces a production build.
- Every migration dry-runs in order and Gate H applies to the linked database.
- The full critical browser regression passes, including the complete Gate G
  client-to-income lifecycle.
- Gate H creates and publishes a tenant-owned form, accepts a privacy-bound
  submission, proves idempotent replay, rejects an unauthorised origin,
  ingests a signed external communication, creates a human matching item and
  denies a foreign tenant.
- Connector contract tests prove the exact HMAC material and versioned header.

## Manual provider evidence

Production approval additionally requires dated staging evidence for:

1. WordPress plus at least one installed form product (Elementor Pro, Contact
   Form 7, WPForms or Gravity Forms).
2. Google Forms installable trigger and an idempotent replay.
3. Meta Lead Ads webhook challenge, signature verification and a test lead.
4. A hosted BusinessOS public form on the production-like web origin.
5. A generic PHP or Node sender from a non-WordPress system.

Provider credentials and DNS/domain ownership cannot be simulated by source
code. Record the successful staging timestamps in the deployment evidence and
pass `-RequireProductionEvidence` before production change approval.

## Failure and abuse cases

- Missing contact route, privacy evidence or a required dynamic field: reject.
- Stale/tampered signature, changed replay body or inactive connection: reject.
- Disallowed browser origin: return 403 without tenant disclosure.
- Honeypot or implausibly fast hosted form: acknowledge non-enumeratively and
  store minimal immutable quarantine evidence; do not create an enquiry.
- Duplicate provider event: return the original subject and correlation IDs.
- Ambiguous email/phone sender: store the inbound message and require a human
  match or dismissal; never guess the client.
- Provider outage: return a non-2xx response so the provider/outbox retries.
- Foreign organisation ID: return 403 with `Cache-Control: no-store`.

## Scope statement

The integration contract is technology-neutral. Any product capable of a
server-side HTTPS request is compatible through the signed canonical contract.
This is stronger and more maintainable than claiming a bespoke plugin for every
current and future website product. A platform that cannot make an HTTPS call
requires a supported relay such as Apps Script, a serverless function, Make,
Zapier, n8n or Power Automate.
