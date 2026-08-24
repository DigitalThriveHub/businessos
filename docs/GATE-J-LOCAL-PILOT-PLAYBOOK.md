# Gate J local pilot playbook

## Purpose

Gate J is the final unpaid local acceptance boundary. It does not turn assumed
readiness into a green badge. BusinessOS declares a controlled pilot ready only
when twelve database-backed controls pass, eight stakeholder journeys contain
real evidence, and no open high or critical pilot defect remains.

## Safe pilot boundary

- Use a dedicated pilot organisation and non-production Stripe credentials.
- Use synthetic or expressly authorised pilot data; do not copy uncontrolled
  customer records into a developer laptop.
- Keep MFA enabled for administrators, finance, managers and solicitors.
- Do not use a local machine as a public production service.
- Do not mark a role as passed unless that person completed the entire script.

## Eight mandatory acceptance journeys

1. **Client:** submit an enquiry, accept terms, make a Stripe test payment,
   upload a clean document, send a message and review matter progress.
2. **Sales:** receive and qualify the enquiry, issue engagement terms, collect
   the agreed initial payment, convert and hand over without re-keying.
3. **Administrator:** detect duplicates, verify identity routing, schedule work,
   correct ownership and control an unmatched communication.
4. **Caseworker:** request documents, accept/reject evidence, complete tasks,
   maintain deadlines and prepare solicitor review.
5. **Solicitor:** review the chronology and evidence, approve or reject
   progression and issue audited instructions without sharing excess access.
6. **Finance:** issue a GBP/VAT-correct invoice, allocate payment, test a refund
   or credit note and verify balanced immutable journals.
7. **Manager:** inspect unassigned work, SLA breach, absence/reassignment,
   exception, approval and audited override behaviour.
8. **Director:** verify lead conversion, cash collected, receivables, workload,
   operational risk and tenant-isolated management reporting.

## Scenarios that must be sampled

- duplicate, rejected, withdrawn and dormant enquiries;
- full payment, deposit, instalment, failed payment, refund and credit note;
- missing, rejected, expired and infected documents;
- conflict, AML, client-care and vulnerable-client handling;
- staff reassignment, absence, deadline breach and management escalation;
- provider failure, queued communication, retry and manual fallback;
- unauthorised role access and cross-tenant access denial;
- closure, cancellation, appeal/reopening and retention restrictions.

Record every defect in **Pilot Readiness**. High and critical defects block the
pilot. A risk may be accepted only by an authorised AAL2 manager with a written,
time-bounded business justification; security, tenant isolation and data-loss
risks must be fixed rather than accepted.

## Exit criteria

The local pilot is complete when:

- the Gate J verification script passes without skips;
- the page reports all 12 system checks ready;
- all eight role journeys are marked PASS with observed evidence;
- no high or critical defect is open;
- the pilot owner signs the operational handover;
- remaining production-only items are limited to hosting, DNS/TLS/WAF,
  production provider credentials, external backup/restore evidence,
  vulnerability scanning and independent penetration testing.

Product functionality that requires an external provider—official WhatsApp,
production email, live card payments and public webhooks—cannot be truthfully
accepted using local mocks alone. Their adapters and controls may be tested
locally, but provider acceptance belongs to the paid production launch.
