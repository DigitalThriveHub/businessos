# Gate L — Unified live communications and calendar

Gate L extends the existing BusinessOS communications, approvals, client portal,
RBAC, RLS and audit pipelines. It is not a standalone inbox and does not replace
existing records with a second CRM.

## What is implemented

- One compact four-tab workspace: Inbox, Calendar, Connections and Client tools.
- Real outbound Microsoft 365 or Google Workspace email.
- Incremental inbound mailbox sync with leased workers, idempotency and an
  unmatched-communications queue.
- Official WhatsApp Business Cloud outbound messages and signed inbound/status
  webhooks, including approved-template mode outside the customer service window.
- Microsoft or Google calendar booking, attendee updates, meeting links,
  cancellation, completion and no-show evidence.
- Connection health, degraded states, retryable delivery jobs, provider failure
  evidence, audited per-connection disable/enable controls and replay-safe
  webhook receipts.
- AAL2 human approval integration: an approved AI action materialises a draft;
  it never sends or marks work executed without a permitted human action.
- Tenant RLS, permission checks, correlation IDs and safe `application/problem+json`
  errors that do not leak provider bodies or credentials.
- Existing portal, templates, reminders, Resend fallback and all non-AI work
  continue normally. OpenAI is not required for Gate L.

## Honest certification boundary

The package can prove code quality locally. It cannot truthfully prove that your
Microsoft/Google/Meta tenants are configured until the real acceptance test uses
those accounts. A successful build is **code-gate passed**. Only the final verifier
message `Gate L LIVE CERTIFIED` means real email, WhatsApp and calendar operations
were exercised against configured providers.

## 1. Server-only configuration

Copy the required values from `apps/api/.env.gate-l.example` into
`apps/api/.env` for local testing or into the production secret manager. Never
commit `.env`. The database stores only an opaque reference such as
`microsoft-main`; it never stores OAuth client secrets, refresh tokens, Meta app
secrets or access tokens.

Enable these only when the real accounts are ready:

```dotenv
GATE_L_LIVE_ENABLED=true
GATE_L_SYNC_ENABLED=true
COMMUNICATION_DELIVERY_ENABLED=true
```

For browser acceptance, add these to `apps/web/.env.local` using dedicated test
records and recipients you control:

```dotenv
E2E_CASE_USER_EMAIL=gate-l-tester@example.co.uk
E2E_CASE_USER_PASSWORD=REPLACE
E2E_CASE_USER_TOTP_SECRET=REPLACE_BASE32
E2E_GATE_L_RECIPIENT_EMAIL=controlled-recipient@example.co.uk
E2E_GATE_L_RECIPIENT_PHONE=+447700900000
```

## 2. Provider account requirements

### Microsoft 365

Create an Entra application using application permissions `Mail.Send`,
`Mail.ReadWrite` and `Calendars.ReadWrite`, grant tenant admin consent, and scope
the application to the intended mailbox in Microsoft 365. Gate L creates and
sends a draft so it can retain a provider message ID, creates calendar events with
a transaction ID, and uses the inbox delta cursor for incremental sync.

Microsoft documents the relevant endpoints and permissions here:

- https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0
- https://learn.microsoft.com/en-us/graph/api/user-post-events?view=graph-rest-1.0
- https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0

### Google Workspace

Create an OAuth client and obtain an offline refresh token for the controlled
mailbox with `gmail.modify`, `gmail.send` and `calendar.events` scopes. Gate L uses
Gmail history IDs, Gmail raw messages and Calendar events with unique Meet request
IDs. Configure an authenticated Pub/Sub push subscription whose audience and
service-account email exactly match the server-only JSON. Polling remains the
authoritative fallback.

- https://developers.google.com/workspace/gmail/api/reference/rest
- https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list
- https://developers.google.com/workspace/calendar/api/v3/reference/events/insert
- https://cloud.google.com/pubsub/docs/authenticate-push-subscriptions

### WhatsApp Business Cloud

Use a Meta system-user access token, app secret, phone-number ID and a random
verification token. Set `graphApiVersion` to a version currently enabled for your
Meta app. If `defaultTemplateName` is present, it must be an approved template
whose body accepts the single BusinessOS text parameter; this supports controlled
messages outside the 24-hour service window. Without that setting, the provider
sends a normal session text and Meta enforces its service-window rules.

Configure the callback as:

```text
https://API_HOST/api/v1/webhooks/providers/WEBHOOK_PUBLIC_ID/whatsapp
```

Subscribe to messages and message status changes. Gate L verifies
`X-Hub-Signature-256` using the Meta app secret before recording anything.

## 3. Apply migrations and configure the connections

Close manually running API/web terminals, then run the code gate and migrations:

```powershell
Set-Location "F:\Projects\BusinessOS"

powershell -ExecutionPolicy Bypass `
  -File ".\scripts\verify-gate-l.ps1" `
  -ApplyMigration
```

Start BusinessOS, open **Communications → Connections**, and configure:

- one Microsoft 365 or Google Workspace connection with `EMAIL` and `CALENDAR`;
- one WhatsApp Business connection with `WHATSAPP`;
- the exact opaque secret references used in the server-only JSON.

Run each health check until both connections show `READY`. The displayed webhook
public ID is safe to put in the provider callback URL; credentials are never shown.

Optional Microsoft notification acceleration uses:

```text
https://API_HOST/api/v1/webhooks/providers/WEBHOOK_PUBLIC_ID/microsoft
```

Google authenticated Pub/Sub push uses:

```text
https://API_HOST/api/v1/webhooks/providers/WEBHOOK_PUBLIC_ID/google
```

## 4. Require real acceptance

After the connections are `READY`, close manually running terminals and run:

```powershell
Set-Location "F:\Projects\BusinessOS"

powershell -ExecutionPolicy Bypass `
  -File ".\scripts\verify-gate-l.ps1" `
  -ApplyMigration `
  -RequireLiveGateL
```

The test signs in with AAL2, proves another tenant is rejected, sends a uniquely
marked real email and WhatsApp message, creates and cancels a real appointment,
polls durable delivery state, checks browser overflow and scans browser assets for
provider secrets.

## UK operational controls before customer use

Gate L provides technical controls; it is not a legal certificate. Before a UK
production rollout, the controller should document lawful purposes, retention,
data-subject handling, international-transfer decisions and processor contracts;
complete a DPIA where the processing is likely high-risk; and apply PECR consent or
soft-opt-in rules to marketing email and messaging. Service/case communications
must not be silently repurposed as marketing.

- ICO DPIA guidance: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/data-protection-impact-assessments-dpias/
- ICO electronic-mail marketing guidance: https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/electronic-and-telephone-marketing/electronic-mail-marketing/
- ICO controller/processor responsibilities: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/contracts-and-liabilities-between-controllers-and-processors-multi/responsibilities-and-liabilities-for-controllers-using-a-processor/

## Recovery

Source application is recoverable from the install backup created by the package.
Database changes are forward-only because enum removal and dropping communication
evidence would be destructive. If a rollout must be stopped, disable
`GATE_L_LIVE_ENABLED`, `GATE_L_SYNC_ENABLED` and
`COMMUNICATION_DELIVERY_ENABLED`, redeploy the prior source, retain the new tables
for audit evidence, and diagnose before a reviewed forward migration.
