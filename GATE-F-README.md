# BusinessOS Gate F

Gate F adds production-shaped external connectivity, online card payments and
management assurance to the verified Gate E baseline.

## Delivered

- deployable WordPress enquiry plugin plus signed generic lead intake with
  per-connection secrets;
- timestamp tolerance, replay protection, idempotency and application throttling;
- privacy-notice version and marketing-consent evidence;
- Stripe Connect Checkout with server-side provider calls only;
- verified Stripe webhooks and atomic invoice/payment/ledger reconciliation;
- no card data, provider secret or raw webhook payload stored by BusinessOS;
- tenant-isolated integration console and immutable event evidence;
- management command centre for enquiries, matters, tasks, deadlines, SLA,
  approvals, receivables and service failures;
- RBAC, AAL2 management controls, RLS and safe BFF routes;
- 25 focused Gate F security/configuration/payment tests plus the complete
  234-test API regression suite;
- deployment, integration and production-acceptance runbooks.

## Important assurance boundary

Gate F is code and deployment guidance, not a bank, government, ISO 27001 or
PCI DSS certification. Production approval also requires configured provider
accounts, a protected hosting environment, live operational monitoring,
restore testing, vulnerability management, independent penetration testing and
documented UK GDPR/security governance.

Run `scripts/verify-gate-f.ps1` before applying the migration. Read
`docs/GATE-F-DEPLOYMENT.md` before enabling a public webhook.
