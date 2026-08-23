# Gate F acceptance record

Do not label Gate F production-approved until all applicable rows are evidenced.

| Control | Required evidence |
|---|---|
| Prisma contract | Format, validation and client generation pass |
| API regression | All Jest suites/tests pass with zero failures |
| API build | Clean Nest production build |
| Web quality | ESLint and Next production build pass |
| Browser regression | All critical Gate D/E/F specs pass with zero skips |
| Database | Linked dry-run and migration list show local/remote parity |
| Signed intake | Valid request accepted, tamper/stale rejected, replay idempotent |
| Tenant isolation | Foreign organisation integration/command-centre reads return 403 |
| Stripe staging | Hosted Checkout created and a test payment reconciled exactly once |
| Accounting | Payment allocation and journal are balanced; invoice balance is correct and gross receipt posts to Stripe clearing rather than bank |
| Payout control | Stripe clearing, payouts, fees, refunds and disputes reconcile to provider evidence under an approved accounting procedure |
| Failure handling | Expired, failed and mismatched payment evidence do not post money |
| Privacy | Raw webhook bodies/provider secrets absent from DB and logs |
| Monitoring | Alerts tested for integration, payment, delivery, scan and automation failures |
| Recovery | Encrypted restore test meets approved RPO/RTO |
| Security | Independent pen test and high/critical remediation complete |
| Governance | DPIA/RoPA, retention, incident, supplier and access-review evidence approved |

Record the release commit, migration version, test output, provider event IDs,
approver, date and environment in the organisation's change record. Never put
secrets or raw client payloads in acceptance evidence.
