# Gate E deployment notes

## Required staging configuration

Gate E reuses the verified Gate D.1 API, web, Supabase and browser-test configuration. The live acceptance account must have AAL2 and the finance permissions required by `e2e/finance.spec.ts`. The existing staging portal account must retain an active matter grant.

## Deployment order

1. Install the Gate E overlay without deleting existing folders.
2. Run `scripts\verify-gate-e.ps1` without switches to review the linked migration dry-run.
3. Confirm finance legal identity, VAT scheme and numbering policy with the business owner or accountant.
4. Run `scripts\verify-gate-e.ps1 -ApplyMigration -RequireLiveGateE`.
5. Retain migration, API test, build and browser reports as release evidence.
6. Verify one staff invoice and one client-portal invoice in staging before production promotion.

## Operational controls

- Use finance roles only for authorised staff and review access regularly.
- Do not edit posted evidence directly in PostgreSQL.
- Correct issued invoices through controlled credit-note, refund, void and reversal workflows.
- Keep provider keys and database credentials in the deployment secret manager.
- Reconcile BusinessOS evidence to the approved bookkeeping/statutory-accounting system until later accounting gates are completed.

## Explicit exclusions

This gate does not claim HMRC MTD submission, statutory accounts, payroll, automated bank reconciliation, payment-provider settlement verification, Open Banking, Corporation Tax filing or accountant certification.
