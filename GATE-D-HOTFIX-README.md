# BusinessOS Gate D automation lifecycle hotfix

This non-destructive overlay fixes the automation worker failure:

```text
SLA subject is unavailable
```

It adds migration `20260821162000_automation_subject_lifecycle_resilience.sql`.
The migration cancels active automation safely when an enquiry, client or matter
is archived, reconciles existing orphaned work, and keeps future worker cycles
operational. It does not change the already-applied Gate D migrations.

## Install

1. Extract this ZIP over the BusinessOS project root and replace matching files.
2. Do not delete any existing project folder.
3. Run from `F:\Projects\BusinessOS`:

```powershell
powershell -ExecutionPolicy Bypass `
  -File ".\scripts\verify-gate-d.ps1" `
  -ApplyMigration
```

The verifier must apply only migration `20260821162000`, pass the direct
automation worker database smoke test, and then pass the critical browser tests.
