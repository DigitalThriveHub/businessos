# Gate G correction — controlled client-to-income lifecycle

This release corrects the earlier shallow Gate G acceptance boundary. It aligns the operational lifecycle with BusinessOS Product Specification v2.0 and the agreed payment-before-work policy.

## Enforced controls

- Legal work cannot become active until a caseworker and supervising solicitor are assigned, conflict/AML/client-care controls are cleared, terms are accepted, and the initial payment is cleared.
- Submission cannot occur until the configured payment threshold and a solicitor `matter.submit` approval are cleared and all lifecycle exceptions are resolved.
- Completion cannot occur until the professional fee is cleared, a `matter.complete` approval exists, an outcome is recorded, and no open tasks or exceptions remain.
- Government fees remain separately recorded from professional income.
- AAL2-authorised users can record and resolve assigned lifecycle exceptions; both actions are audited.
- Management sees outstanding fees, exact blockers and unresolved exceptions.
- `/api/v1/health/live` and `/api/v1/health/ready` support production orchestration.
- Production startup requires release, monitoring and recent restore-test evidence configuration.

## Acceptance evidence

`service-lifecycle-end-to-end.spec.ts` submits a signed website-form event, creates and qualifies the enquiry, converts it into an assigned client and matter, clears compliance, accepts an engagement, proves pre-deposit work is blocked, records three staged payments, obtains submission and completion approvals, proves an open exception blocks submission, resolves it, records the outcome, closes the matter, verifies readiness and verifies tenant isolation.

This is meaningful end-to-end coverage, not a page-presence test.

## Claims deliberately not made

This source code is not itself ISO 27001 certification, a penetration-test report, a bank approval or a UK government accreditation. Those require a deployed production environment, operational policies, evidence collection and independent assessment. The verifier can require configuration evidence, but it cannot fabricate certification.
