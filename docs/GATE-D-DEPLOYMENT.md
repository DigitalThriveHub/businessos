# BusinessOS Gate D deployment

Gate D adds a secure client portal and controlled communications loop without replacing or deleting Gate C files.

## Delivered capability

- Verified-email, opaque-token portal invitations.
- Explicit, scoped, time-aware and revocable client access grants.
- Per-matter portal progress, notifications and two-way secure messages.
- Client uploads into the existing private quarantine and malware-scanner pipeline.
- Outbound email queue with idempotency, leases, retries and append-only delivery evidence.
- Signed Resend webhooks, templates and scheduled reminders.
- Tenant-aware PostgreSQL RLS and MFA-gated staff permissions.
- WhatsApp database extension point that remains fail-closed until an approved provider is implemented.

Gate D is an additive product release. It is not, by itself, ISO 27001 certification, a penetration-test result, a backup-restore result or approval to process live client data.

## Required API environment

Set these in the API secret manager. Never commit them or paste them into support messages.

```text
WEB_APP_URL=https://app.example.co.uk
PORTAL_INVITATION_TOKEN_SECRET=<independent random secret, at least 32 characters>
PORTAL_INVITATION_TTL_HOURS=168

RESEND_API_KEY=<Resend API key>
RESEND_WEBHOOK_SECRET=<Resend signing secret beginning whsec_>
EMAIL_FROM_ADDRESS=notifications@example.co.uk
EMAIL_FROM_NAME=BusinessOS
EMAIL_REPLY_TO=support@example.co.uk

COMMUNICATION_DELIVERY_ENABLED=false
COMMUNICATION_DELIVERY_POLL_INTERVAL_MS=5000
COMMUNICATION_DELIVERY_LEASE_SECONDS=120
COMMUNICATION_DELIVERY_WORKER_ID_PREFIX=businessos-api
```

`PORTAL_INVITATION_TOKEN_SECRET` must differ from `INVITATION_TOKEN_SECRET`. Start with delivery disabled; enable it only after domain, webhook and staging delivery checks pass.

Generate a secret in PowerShell without displaying or storing it in source control:

```powershell
$bytes = New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$secret = [Convert]::ToBase64String($bytes)
$secret
```

## Required web environment

```text
NEXT_PUBLIC_APP_URL=https://app.example.co.uk
API_URL=https://api.example.co.uk
NEXT_PUBLIC_SUPABASE_URL=<project URL>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>
```

Keep staging-only E2E credentials out of production. For full staging portal acceptance, configure:

```text
E2E_PORTAL_USER_EMAIL=<dedicated invited staging client>
E2E_PORTAL_USER_PASSWORD=<staging-only password>
E2E_PORTAL_USER_TOTP_SECRET=<only when that client account uses MFA>
```

## Safe rollout order

1. Confirm database backups/PITR and complete a recent restore drill.
2. Install the overlay only after creating a source backup.
3. Run `scripts\verify-gate-d.ps1` without switches. This performs code gates and a migration dry-run only.
4. Review the two pending `20260821160000` and `20260821161000` migrations.
5. Run the script with `-ApplyMigration`; approve the Supabase prompt once.
6. Deploy the API and web with `COMMUNICATION_DELIVERY_ENABLED=false`.
7. Verify the sending domain and create a signed Resend webhook for `https://api.example.co.uk/api/v1/webhooks/resend`.
8. Complete the staging scenarios below, then set `COMMUNICATION_DELIVERY_ENABLED=true` and restart the API workers.
9. Re-run with `-ApplyMigration -RequireLiveGateD` after provisioning a dedicated portal client.

Resend documents webhook signature verification and event delivery at:

- https://resend.com/docs/webhooks/verify-webhooks-requests
- https://resend.com/docs/webhooks/event-types
- https://resend.com/docs/dashboard/emails/send-test-emails

## Live staging acceptance scenarios

All scenarios must be performed with disposable staging data.

1. Staff AAL2 user creates a client and matter, then sends a portal invitation to a dedicated client address.
2. Client confirms that exact email, accepts once, and sees only granted matters and scopes.
3. Staff publishes progress; client sees the update and notification.
4. Staff and client exchange portal messages; each appears on the correct matter timeline.
5. Staff sends an email and schedules a reminder; accepted/delivered/bounced evidence is recorded from signed webhooks.
6. Staff creates a document request. Client uploads a benign PDF; it remains unavailable until the scanner reports `CLEAN`.
7. Upload the EICAR test file in isolated staging. Confirm quarantine/dead-letter behaviour and that no client download is possible.
8. Revoke portal access. Confirm the client immediately loses dashboard, message, document and notification access.
9. Use a second organisation and random record identifiers to confirm tenant isolation returns 403/404 without data.
10. Simulate provider failure and worker restart; confirm leases expire safely, retries are idempotent and terminal failures are visible.

## Production controls still required outside source code

- UK GDPR/DPA 2018 data mapping, lawful-basis records, DPIA, privacy notices and retention policy approval.
- Supplier due diligence and DPAs for hosting, Supabase, Resend and future providers.
- Centralised logs/alerts for failed email, webhook rejection, scan dead letters, auth anomalies and database capacity.
- Tested encrypted backups, restore objectives, disaster recovery and incident response.
- Independent penetration testing, dependency scanning and remediation evidence.
- Access reviews, joiner/mover/leaver evidence and least-privilege production credentials.
- Change control, release approval, vulnerability handling and ISO 27001 evidence where certification is claimed.

Do not enable WhatsApp in production from this release. Gate D deliberately rejects WhatsApp mutations until a provider-specific signed webhook, consent, opt-out, template and retention implementation is added and tested.
