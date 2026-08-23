# Gate F deployment runbook

## 1. Preconditions

- Gate E is committed and the remote migration list is synchronised.
- Staging and production use separate Supabase, Stripe and email resources.
- The API has a stable HTTPS public origin behind a managed WAF/load balancer.
- `TRUST_PROXY_HOPS` equals the reviewed number of trusted reverse-proxy hops;
  never enable unrestricted proxy trust.
- `DATABASE_URL` uses only `businessos_runtime`; migrations use the separate
  migration credential, and the production URL requires TLS.
- Production secrets are supplied by the hosting secret manager, not `.env`
  files in source control.

## 2. Required Gate F secrets

Configure the values documented in `apps/api/.env.gate-f.example`.

- Generate `INTEGRATION_SIGNING_MASTER_SECRET` independently from every other
  invitation or webhook secret. Use at least 48 cryptographically random bytes.
- Set `INTEGRATION_WEBHOOK_TOLERANCE_SECONDS=300` unless a reviewed threat model
  justifies another value.
- Pin `STRIPE_API_VERSION` to the version configured and tested in the Stripe
  account.
- Staging uses `sk_test_...`; production validation rejects test keys.

Never copy these values into tickets, browser code, database rows, screenshots
or support messages.

## 3. Database and application release

From the project root:

```powershell
powershell -ExecutionPolicy Bypass -File ".\scripts\verify-gate-f.ps1"
```

When every code gate and the linked migration dry-run pass:

```powershell
powershell -ExecutionPolicy Bypass -File ".\scripts\verify-gate-f.ps1" -ApplyMigration
```

Deploy the API and web build from the same immutable commit. Do not enable
public provider traffic until health checks, migrations and smoke tests pass.

## 4. Stripe setup

1. In staging, configure Stripe test mode first.
2. Create the Stripe connection in BusinessOS **Integrations**. For a platform
   account use its `acct_...` value; for Stripe Connect use the tenant connected
   account ID.
3. Configure this Stripe webhook endpoint:
   `https://API_ORIGIN/api/v1/webhooks/stripe`.
4. Subscribe only to:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
5. Put the endpoint signing secret in `STRIPE_WEBHOOK_SECRET` and restart the
   API through the controlled deployment process.
6. Run a staging invoice through Checkout, complete it with a Stripe test card,
   and verify: one checkout, one receipt, one allocation, one balanced journal,
   invoice balance zero, Stripe-clearing debit, and duplicate webhook accepted
   without duplicate posting.
7. Repeat failure, expiry and changed-invoice-balance scenarios.

Checkout settlement posts gross receipts to the `STRIPE_CLEARING` asset—not
directly to bank. Reconcile Stripe payouts, processing fees, refunds and
disputes from clearing to bank/expense accounts under the organisation's
approved accounting procedure. Do not represent the clearing balance as cash.

BusinessOS uses hosted Stripe Checkout. Card details must never traverse the
BusinessOS web or API servers. Confirm the organisation's PCI DSS scope and
SAQ obligations with its acquirer or qualified adviser.

## 5. WordPress or other lead source

For WordPress, install the production connector from
`integrations/wordpress/businessos-secure-intake`. Create a `WORDPRESS`
connection in **Integrations**, copy the one-time secret, and configure the
documented constants in `wp-config.php`. Add `[businessos_enquiry_form]` to the
form page. Never place the secret in a page builder, front-end JavaScript or a
public WordPress option.

For another lead source, create a `GENERIC` connection and implement
`GATE-F-INTEGRATION-CONTRACT.md` in a server-side component. In both cases,
verify signed acceptance, tamper rejection, stale timestamp rejection and
idempotent replay in staging before enabling the source in production.

At the edge, allow only HTTPS, enforce a 64 KiB request limit, retain the
application throttle, and add managed bot/DoS controls. Alert on signature
failures, stale timestamps, sustained 4xx/5xx responses and intake latency.

## 6. Operations and assurance before production approval

- Centralise redacted API, database, WAF and provider logs with alert ownership.
- Alert on payment evidence mismatch, failed integration events, dead-letter
  automation/scanner work, failed communications and overdue operational work.
- Enable database point-in-time recovery and encrypted backups; perform and
  evidence a restore test against agreed RPO/RTO.
- Rotate provider and signing secrets through a two-person change process.
- Run dependency, SAST, secret and infrastructure scans in CI on every release.
- Commission independent authenticated penetration testing and remediate all
  critical/high findings before handling live client or payment data.
- Complete UK GDPR records of processing, data retention/deletion rules, DPIA
  where required, processor contracts, incident response and DSAR procedures.
- Verify SPF, DKIM and DMARC for email and document the Stripe/Resend/Supabase
  supplier and data-transfer assessment.

Relevant baselines include the NCSC guidance for securing HTTP APIs and the ICO
data-protection-by-design guidance. Certification or government/bank assurance
is an evidence programme; it is not created by a code release alone.
