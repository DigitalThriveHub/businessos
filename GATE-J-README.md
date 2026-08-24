# Gate J — controlled local pilot readiness

Gate J adds an evidence-backed pilot control centre, twelve automatic readiness
checks, eight stakeholder acceptance journeys, a tenant-isolated defect register,
audited defect resolution, optimistic concurrency, AAL2 management decisions and
a complete local pilot playbook. It refuses to declare readiness from test counts
alone.

Validated before packaging: Prisma format/validation/generation, 55 API suites,
249 API tests, API build, web lint, web production build and Gate J browser-test
compilation. The live run applies the migration and executes the complete 15-test
critical browser regression with zero permitted skips.

Gate J is the local-pilot boundary. Paid hosting, DNS/TLS, managed backups,
production provider credentials, load evidence, independent penetration testing
and certification remain production-launch evidence and cannot be simulated by a
local test.

Run:

`scripts/verify-gate-j.ps1 -ApplyMigration -RequireLiveGateJ`
