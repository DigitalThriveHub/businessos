# BusinessOS Gate D

Gate D is a non-destructive source overlay for the existing BusinessOS project. It adds the secure client portal and controlled communications foundation while retaining Gates A-C.

## Install safely

1. Back up the current project.
2. Extract this ZIP to a temporary folder.
3. Copy the ZIP contents over the existing BusinessOS root and allow matching source files to be replaced.
4. Do not delete the existing `apps`, `supabase`, `docs` or `scripts` folders.
5. Do not copy, replace or commit `.env` files.
6. Run `scripts\verify-gate-d.ps1` without switches before applying migrations.

The verification script formats and validates Prisma, regenerates the local client, runs API tests and builds, runs the web lint/build, compiles the five critical browser specifications, and performs a linked Supabase migration dry-run.

After reviewing the dry-run and configuring the required secrets, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-gate-d.ps1 -ApplyMigration
```

For final staging acceptance with a provisioned client portal account, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-gate-d.ps1 -ApplyMigration -RequireLiveGateD
```

See `docs\GATE-D-DEPLOYMENT.md` and `docs\GATE-D-ACCEPTANCE.md` before processing live client data.

