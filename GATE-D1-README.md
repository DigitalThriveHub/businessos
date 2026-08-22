# BusinessOS Gate D.1 — Client onboarding hardening

This patch preserves a client portal invitation through account creation,
email confirmation, sign-in and MFA. It also routes an accepted portal-only
account back to the client portal and prevents that identity from using the
organisation bootstrap function.

## Included

- safe invitation-aware login and signup redirects;
- a clear first-time-client account path;
- authenticated invitation acceptance and account switching;
- portal-only dashboard fallback;
- database-enforced organisation-bootstrap restriction;
- API regression coverage for portal-only bootstrap denial;
- Playwright regression coverage for invitation-context preservation.

## Verify and apply

After extracting the patch over `F:\Projects\BusinessOS`, run the existing
Gate D verifier once:

```powershell
Set-Location "F:\Projects\BusinessOS"
powershell -ExecutionPolicy Bypass `
  -File ".\scripts\verify-gate-d.ps1" `
  -ApplyMigration `
  -RequireLiveGateD
```

The command must finish with `Gate D verification completed successfully.`
and all nine browser tests passed with no skips.
