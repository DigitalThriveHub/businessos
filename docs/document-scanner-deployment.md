# BusinessOS document scanner deployment

This batch releases quarantined matter documents only after a private ClamAV
daemon has scanned the exact stored bytes and the observed SHA-256 matches the
hash registered before upload. Infected, mismatched and terminal-error files
remain quarantined.

## Production prerequisites

1. Deploy a currently supported ClamAV daemon from a vendor-controlled image,
   pinning the image by immutable digest. Do not expose its TCP port publicly.
2. Run signature updates continuously and alert when signatures are stale or
   the daemon is unhealthy. Keep `StreamMaxLength` at least as large as
   `DOCUMENT_SCANNER_MAX_FILE_BYTES`.
3. Permit the API/worker network identity to reach only the private ClamAV
   endpoint and the required Supabase HTTPS endpoints.
4. Put `SUPABASE_SERVICE_ROLE_KEY` in the deployment secret manager. It is a
   backend-only credential and must never enter Next.js public environment
   variables, browser logs, build artefacts or source control.
5. Configure either a protected Unix socket or private TCP hostname, never both.
   Restrict socket ownership or network policy to the BusinessOS runtime.

## Safe deployment order

1. Deploy ClamAV, verify its health and current signatures, but keep
   `DOCUMENT_SCANNER_ENABLED=false`.
2. Apply `20260820160000_document_scanner_pipeline.sql` after the full API/web
   verification gate succeeds.
3. Add the scanner variables shown in `apps/api/.env.scanner.example` through
   the secret/configuration service.
4. Restart the API with `DOCUMENT_SCANNER_ENABLED=true`. Multiple replicas are
   supported: PostgreSQL leases prevent the same job being processed normally
   by more than one worker.
5. In a non-production environment, upload one harmless file and the standard
   EICAR anti-malware test file. Confirm the harmless file becomes `AVAILABLE`,
   the EICAR file remains `QUARANTINED`, and both service-actor events appear in
   the append-only matter timeline and audit log. Never use real client data for
   this smoke test.
6. Run the authenticated Playwright test with its three values held in CI
   secrets:

   ```powershell
   Set-Location "F:\Projects\BusinessOS\apps\web"
   npx playwright test e2e/case-operations.spec.ts --project=chromium
   ```

## Operational checks

- Alert on queued jobs older than the agreed scanning service level.
- Alert immediately on `DEAD_LETTER`, repeated `LEASE_EXPIRED`, signature-update
  failures, scanner unavailability and malware detections.
- Keep scanner and API clocks synchronised and centralise logs without raw file
  contents, service keys, passwords or TOTP secrets.
- Test restore, retry, incident-response and quarantine procedures regularly.
- If the scanner becomes unsafe, set `DOCUMENT_SCANNER_ENABLED=false`. New and
  pending files stay quarantined; this is the intended fail-closed state.

Privileged operations staff can inspect queue health through a protected
database session:

```sql
SELECT status, count(*) AS jobs, min(created_at) AS oldest_created_at
FROM public.document_scan_jobs
GROUP BY status
ORDER BY status;
```

These technical controls support a GDPR/ISO 27001 security programme. Formal
compliance still requires documented policies, DPIAs, retention decisions,
supplier assurance, monitoring evidence, penetration testing and independent
assessment where required.
