# Gate I production runbook

## Release boundary

Gate I provides deployable containers, fail-closed production configuration,
dependency health, token-protected operational diagnostics, queue alerts and a
repeatable launch check. It does not claim ISO 27001 certification or replace
independent penetration testing.

## Required production architecture

1. Put the web service behind a reviewed UK/EU-region WAF, TLS load balancer and
   DDoS protection. Only the load balancer may reach the web container.
2. Keep the API and ClamAV on private networks. The browser reaches the API only
   through the web BFF except signed provider webhooks.
3. Store all secrets in the hosting provider's secret manager. Never upload the
   example environment file or a populated `.env` to Git.
4. Use immutable image digests, non-root containers, read-only filesystems,
   dropped Linux capabilities and `no-new-privileges`.
5. Run at least two API and two web replicas across failure domains. Workers use
   database leases and remain safe under multiple replicas.

## Recovery and backup

- Enable Supabase Point-in-Time Recovery to meet the agreed RPO. Daily backups
  alone may lose up to a day of changes.
- Database backups do not contain Storage objects. Back up private Storage
  buckets separately to encrypted, versioned storage in another account/region.
- Export authentication configuration, custom-role restoration steps, DNS,
  webhook destinations and secret inventory without secret values.
- Every quarter restore database and Storage into an isolated recovery project,
  reset custom-role passwords, run migrations and the complete browser suite,
  then record `BACKUP_RESTORE_EVIDENCE_AT`.
- Never test a destructive restore against production.

Target defaults: RPO 5 minutes and RTO 60 minutes. Change them only through an
approved business-impact assessment and tested recovery plan.

## Monitoring and incident response

- Probe `/api/v1/health/live` for process health and `/health/ready` for database
  readiness. Neither exposes operational details.
- Restrict `/health/diagnostics` using an independent operations token and do not
  expose it through public dashboards.
- Alert on any dead-letter scan, failed integration, disabled critical worker,
  high backlog, readiness failure, elevated 5xx rate or authentication anomaly.
- Route alerts to the named incident owner and maintain 24/7 escalation for
  production. Preserve audit/security logs according to the approved retention
  schedule and legal obligations.
- Run the bounded readiness capacity smoke during every release. It is a safe
  regression threshold, not a substitute for workload-specific load, soak and
  failover tests sized from actual customer volumes.

## Deployment and rollback

1. Build and scan both images from the tagged commit.
2. Apply database migrations before switching application traffic.
3. Deploy API/web canaries and verify readiness and diagnostics.
4. Run the critical browser suite against staging, then production-safe probes.
5. Shift traffic gradually while observing error rate, latency and queues.
6. Roll back application images to the previous immutable digest if service
   health degrades. Database migrations are forward-only; use a reviewed
   corrective migration, never an ad-hoc destructive rollback.

## Evidence required before customers

- Successful container vulnerability scan and software inventory
- Independent authenticated and unauthenticated penetration test
- Restored database plus Storage drill within 92 days
- WAF/rate-limit verification, alert delivery exercise and incident tabletop
- Tested Stripe, Resend, WordPress, Meta, Google Forms and webhook rotations
- UK GDPR records: processing inventory, retention schedule, DPIA where needed,
  processor contracts, breach process and data-subject-rights procedure
- ISO 27001 scope, risk treatment, policies, internal audit and management review

These are organisational and third-party assurance activities. Passing automated
tests alone is not evidence that they occurred.
