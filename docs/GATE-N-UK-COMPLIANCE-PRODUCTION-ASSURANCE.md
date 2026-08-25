# Gate N operating and release standard

## Purpose and boundary

This runbook turns the final BusinessOS engineering gate into an auditable
operating process for a UK organisation. It is written for the controller,
security owner, service owner, compliance lead and release approver.

BusinessOS supports evidence and workflow. It does not provide legal advice,
act as the controller, certify ISO 27001 compliance or conduct an independent
penetration test. “Bank-grade” is not a recognised pass/fail technical standard;
the release decision must instead be supported by named controls, evidence,
scope, expiry, owners and residual-risk acceptance.

## Roles and separation

Use different named people for:

1. **Recorder** — runs the test or receives the independent report, verifies its
   scope and records its immutable location and SHA-256.
2. **Reviewer** — independently checks the source, hash, scope, limitations,
   remediation and expiry, then passes, fails or blocks it at AAL2.
3. **Release approver** — reviews all blockers and evidence snapshots, accepts
   residual risk and records the production decision at AAL2.

The database prevents the recorder from reviewing their own evidence. For
backup restoration, penetration testing and UK pilot acceptance, it also
prevents the evidence reviewer from approving the release.

## Data-subject-right workflow

1. Record the request immediately, including intake evidence and at least one
   reliable matching route: email, phone or linked client.
2. Confirm the request type and owner. BusinessOS calculates a one-calendar-
   month target; the responsible UK controller must assess the actual statutory
   deadline, complexity, extensions and exemptions.
3. If complexity or request volume justifies more time, an AAL2 manager may
   record one extension of no more than two additional months. A substantive
   reason and evidence that the person was notified are mandatory; BusinessOS
   records the decision but does not declare it lawful.
4. Move to identity verification and store only an evidence reference—not a
   copy of unnecessary identity material in notes.
5. For access/portability, generate a candidate only after identity is verified.
   It includes tenant-matched client, enquiry, matter, document metadata,
   communication and finance records.
6. A qualified human checks identity, completeness, third-party information,
   privilege, exemptions, secure delivery method and accessibility. BusinessOS
   never sends the candidate automatically.
7. Completion/refusal needs a response evidence reference. Every transition is
   versioned and appended to the event/audit history.

## Privacy incident and breach workflow

1. Record suspected incidents immediately. If personal data may be involved,
   enable the breach flag; the system starts a 72-hour evidence clock from the
   recorded discovery time.
2. Contain without destroying evidence. Preserve timestamps, affected systems,
   data categories, approximate people, access logs and response actions.
3. Assess likelihood and severity of risk to people. The authorised controller
   decides whether and when ICO and affected-person notification is required.
4. `ICO_NOTIFIED` requires an ICO reference. `SUBJECTS_NOTIFIED` requires a
   notification evidence reference. The workflow rejects unsupported claims.
5. Resolve only with a substantive risk assessment and resolution. High or
   critical open incidents and unresolved notification decisions block release.
6. Follow the organisation’s counsel-approved incident plan and cyber-insurance
   notification terms. Do not use the software clock as legal advice.

## Retention and legal holds

- Retention rules must be approved per record class, trigger, business/legal
  rationale, duration and disposition. Avoid an indefinite default.
- A review is a decision record, not a deletion job. Archive, anonymise or delete
  must be executed by an approved adapter/process, then referenced with durable
  execution evidence.
- Active organisation/client/matter/document holds are inherited across linked
  matter, document, finance and communication records. A destructive decision
  becomes `BLOCKED` while a matching hold exists.
- Releasing a hold requires a reason and optimistic version match. Never release
  a hold merely to clear a release dashboard.
- Sample retention periods are not supplied because they depend on the sector,
  services, limitation periods, regulator, contracts and legal advice.

## Mandatory evidence catalogue

Each evidence item must include its exact environment/scope, immutable source
reference, SHA-256, tester, tester organisation where independent, test time,
expiry, result, limitations and remediation status. Empty scope is rejected.
The database caps validity at 45 days for vulnerability scans; 100 days for
live-provider and monitoring evidence; 120 days for restore evidence; 185 days
for UK-pilot evidence; and 370 days for the remaining mandatory controls.
Record a shorter expiry whenever the report, assessor or change policy requires
one, and reassess after every material change even if the date has not elapsed.

| Evidence key | Minimum acceptable evidence |
|---|---|
| `backup.restore` | Isolated restoration of database, private objects, auth/configuration and secrets rotation; measured RPO/RTO and signed result. |
| `security.penetration_test` | Independent authenticated and unauthenticated test of the deployed scope plus remediation/retest; assessor organisation is mandatory. |
| `security.vulnerability_scan` | Current dependency, code, secret, container and infrastructure scan with critical/high findings resolved or formally accepted. |
| `operations.capacity_test` | Volume model, load/soak results, latency/error thresholds, queue saturation and provider/database failure recovery. |
| `operations.incident_tabletop` | Named participants, scenario, decisions, communications, gaps, actions and retest. |
| `privacy.dpia` | Controller-approved DPIA covering purpose, necessity, proportionality, risks, AI/providers, mitigations and sign-off. |
| `privacy.ropa` | Current processing inventory, purposes, categories, recipients, transfers, retention and security measures. |
| `privacy.processor_contracts` | Processor/subprocessor terms, UK transfer mechanism assessment, location, deletion/return and incident obligations. |
| `accessibility.wcag22` | WCAG 2.2 AA review with keyboard, screen-reader, zoom/reflow, contrast and error-handling evidence plus remediation. |
| `acceptance.uk_pilot` | Eight role journeys, one full enquiry-to-income path, exception cases, user acceptance and no unresolved high/critical defects. |
| `providers.live_operations` | Real test tenants/accounts for email, WhatsApp, calendar, payment, AI and intake providers, including webhooks, failure/retry and revocation. |
| `operations.monitoring_alerts` | Production dashboards, alert thresholds, paging/escalation, synthetic probes, redaction and a received/acknowledged test alert. |

## Production deployment control

Before approval:

- Use UK/EU regions selected through a documented data-residency and transfer
  assessment; private API/database/ClamAV networks; reviewed WAF, TLS and DDoS;
  and least-privilege service identities.
- Put credentials only in a managed secret store, rotate every exposed secret,
  restrict provider projects/accounts, and test revocation. Never commit `.env`,
  browser state, service-account JSON, private keys or evidence containing
  personal data.
- Deploy immutable image digests with SBOM/vulnerability evidence, non-root
  users, read-only filesystems, dropped capabilities and at least two web/API
  replicas across failure domains.
- Apply forward-only migrations, then canary. Validate readiness, diagnostics,
  user journeys, webhooks and queues before traffic shift. Roll application
  images back on regression; correct schema with a reviewed forward migration.
- Confirm backups cover both PostgreSQL and private object storage. Test restore
  in isolation at least quarterly and after material architecture change.
- Prove log redaction, audit retention, alert delivery and 24/7 escalation for
  critical production incidents.

## Approval and revocation

The Assurance centre computes blockers at decision time and stores immutable
copies of blockers and mandatory evidence. Approval is rejected if any blocker
exists. Evidence expiring after approval, a new critical incident, provider
failure or material change requires reassessment and, where necessary, a
`REVOKED` decision followed by a new release reference after remediation.

Approval means only: the named approver accepted the documented release based
on the captured evidence at that time. It is not a permanent certification.

## Stop conditions

Do not onboard real customers when any of the following is true:

- the Gate N migration, API/web builds, full regression or tenant-isolation test
  fails;
- mandatory evidence is missing, expired, failed, self-reviewed or out of scope;
- a high/critical incident, notification decision, overdue right/retention item,
  pilot gap or high defect remains open;
- backups have not been restored, monitoring alerts have not reached a human,
  or production secrets/provider accounts have not been validated;
- the independent tester, compliance owner, service owner or authorised release
  approver has not accepted the actual deployed scope.
