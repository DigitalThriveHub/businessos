# BusinessOS Gate E

Gate E is a non-destructive source overlay for the verified Gate D.1 release. It adds a tenant-isolated UK billing and accounting-control foundation without deleting existing BusinessOS files.

## Included

- Organisation finance settings, GBP defaults and VAT schemes.
- Draft invoices and credit notes with integer minor-unit calculations.
- Controlled issue, sequential references, void and reversal evidence.
- Receipt and refund allocation with idempotency controls.
- Append-only double-entry journals.
- Finance permissions, MFA-sensitive actions and row-level security.
- Staff finance workspace and client-portal billing visibility.
- Unit, build and browser acceptance gates.

## Install

Extract the ZIP over the existing BusinessOS root and replace matching source files. Do not delete `apps`, `supabase`, `scripts` or `docs`, and do not replace any `.env` file.

Then run from `F:\Projects\BusinessOS`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-gate-e.ps1 -ApplyMigration -RequireLiveGateE
```

The command validates Prisma, runs the complete API regression suite, builds API and web, checks all six critical browser specifications, previews and applies the linked migration, verifies migration history, and runs the live browser acceptance suite with no permitted skips.

## Release boundary

Gate E supplies operational billing and immutable accounting evidence. It is not a substitute for accountant approval, statutory year-end accounts, Corporation Tax filing, payroll, bank feeds, reconciliation, Open Banking, or HMRC Making Tax Digital submission. Those remain later production gates.
