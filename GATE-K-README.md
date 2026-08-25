# Gate K — governed personal AI workspace

Gate K adds one private `/ai` workspace for every authorised BusinessOS
employee. It extends the existing Supabase/PostgreSQL tenant model, Prisma
schema, Nest API, Next.js dashboard, RBAC catalogue, AAL2 approval flow and
audit trail. It is not a standalone application and does not introduce a
second user, customer, task or permission store.

## What is implemented

- Role-, tenant-, employee- and workload-aware daily briefs and chat.
- Permission-filtered context from existing enquiries, matters, tasks,
  deadlines and approvals. Email addresses and telephone numbers are not sent
  in the AI workload context.
- Private per-employee conversation and message history. A manager cannot read
  another employee's AI history merely because the manager can read the
  underlying business record.
- OpenAI Responses API integration using server-only credentials,
  `store: false`, bounded output and a strict JSON schema.
- Governed draft/proposal tools for tasks, document requests, communications
  and escalation. Record access, the employee's authority ceiling, policy
  limits and the tool allowlist are checked again after the model responds.
- Every accepted proposal is routed to the existing independent human approval
  workflow. AAL2 approval never marks the proposed operation as executed.
- Append-only message, provider-usage and tool-call evidence; run lifecycle,
  provider request identifiers, latency, token usage, audit events and
  fail-closed provider handling.
- Automatic Gate K profile, policy and role provisioning for both existing and
  future BusinessOS organisations and employee memberships.
- A real-provider Playwright acceptance test plus cross-tenant rejection,
  browser-secret checks and the critical browser regression.
- Repair of the existing API build-root error: production now emits the
  `dist/main.js` file used by `npm run start:prod` and the API Docker image.
- An explicit cost-safe free testing mode. It makes no provider call, keeps the
  role-filtered workload visible, disables AI generation and clearly explains
  what requires an upgrade. Every non-AI BusinessOS workspace continues
  normally.

Validated before packaging in the supplied source snapshot: Prisma format,
validation and generation; complete API lint; 57 API suites and 257 tests; API
production build with `dist/main.js`; complete web lint; Next.js 16.3.0
production build; and compilation of both Gate K browser scenarios. Applying
the linked migration and calling the real provider remain environment-owned
evidence and are enforced by the strict command below.

## Server-only configuration

For free/no-charge testing, do not configure a provider. Add this server-only
value to `apps/api/.env`:

```dotenv
OPENAI_AGENT_ENABLED=false
```

For paid/live AI only, create a fresh OpenAI project key. Do not reuse a key
that has appeared in chat, terminal history, a screenshot or source control.
Add these values only to `apps/api/.env` or the production secret manager:

```dotenv
OPENAI_AGENT_ENABLED=true
OPENAI_API_KEY=sk-proj-your-new-project-key
OPENAI_AGENT_MODEL=your-approved-project-model
OPENAI_AGENT_TIMEOUT_MS=30000
OPENAI_AGENT_MAX_OUTPUT_TOKENS=1800
```

The OpenAI API is a separately billed provider service; an API key and enabled
model are not bundled with BusinessOS. OpenAI provider calls are impossible
while `OPENAI_AGENT_ENABLED=false`. Gate K intentionally does not pretend a
paid provider is free. The provider boundary is isolated in
`OpenAiGatewayService`, so a separately tested local/provider adapter can be
added later without replacing the BusinessOS workspace or governance model.

## Apply and prove it

Start from the exact uploaded Gate J source commit
`f128100745ce1eeeeea3c503e54759e2ed4dd5be`. Keep real `.env` files local and
make a database backup before applying a production migration.

After applying the overlay and adding a **new** key, close manually running API
and web terminals, then run:

```powershell
Set-Location "F:\Projects\BusinessOS"

powershell -ExecutionPolicy Bypass `
  -File ".\scripts\verify-gate-k.ps1" `
  -ApplyMigration `
  -RequireLiveGateK
```

`RequireLiveGateK` is deliberately strict. It requires AAL2 browser
credentials, a real OpenAI response, the migration, tenant-isolation evidence
and the complete critical browser regression with no skipped tests.

For the requested free/no-charge validation, keep
`OPENAI_AGENT_ENABLED=false`, omit the provider key and model, then run:

```powershell
Set-Location "F:\Projects\BusinessOS"

powershell -ExecutionPolicy Bypass `
  -File ".\scripts\verify-gate-k.ps1" `
  -ApplyMigration `
  -FreeMode
```

This verifies and applies Gate K without making an OpenAI request. It cannot be
used as evidence that the paid/live provider path works.

For code/build checks and a linked migration dry run without changing the
database:

```powershell
powershell -ExecutionPolicy Bypass `
  -File ".\scripts\verify-gate-k.ps1"
```

## Honest completion boundary

Gate K is complete only after the strict live command passes in your linked
environment. Local compilation cannot manufacture database, provider or AAL2
evidence.

Gate K also does **not** make the entire Product Specification v2.0 complete.
Unified real email/WhatsApp/calendar, document intelligence, broader native
connectors and generic operations, complete management workspaces, and UK
production/compliance launch evidence remain Gates L–P. Approved Gate K
proposals are records for controlled follow-on execution; connecting every
approved proposal to an operational adapter belongs to those later gates.
