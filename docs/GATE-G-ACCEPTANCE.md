# Gate G production acceptance matrix

Gate G is accepted only when one isolated test organisation proves the complete
lead-to-income lifecycle and every negative gate below rejects safely.

## Primary journey

1. WordPress signed intake creates one enquiry and replay creates no duplicate.
2. Sales qualifies, scopes and converts the enquiry to one client and matter.
3. Sales creates an engagement with professional fees, separately disclosed
   government fees, initial clearance and pre-submission clearance.
4. Instalments equal the agreed professional fee exactly.
5. Client terms are accepted and the initial invoice becomes visible.
6. Legal-work activation fails before the initial payment.
7. Stripe test payment clears, allocates to the invoice and unlocks legal work.
8. Caseworker completes controlled onboarding, compliance, documents and tasks.
9. Submission fails while the configured clearance remains unpaid.
10. Final instalment clears; authorised solicitor approves and submits.
11. Finance confirms invoice, receipt, allocation, Stripe-clearing and balanced
    journal evidence without duplicate posting.
12. Manager closes the matter and leadership reporting shows fees, cash,
    government-fee liabilities, exceptions and outstanding balances correctly.

## Mandatory adverse scenarios

- duplicate enquiry, duplicate payment and duplicate webhook;
- rejected/withdrawn prospect and cancelled engagement;
- missing primary client, invalid fee thresholds and instalment mismatch;
- failed, partial, late, reversed, refunded or disputed payment;
- expired/rejected/infected document and failed communication delivery;
- conflict, identity, source-of-funds or compliance failure;
- no-show, reschedule, staff absence, reassignment and missed deadline;
- scope/fee change, complaint, withdrawal, refusal, appeal and reopening;
- unauthorised tenant, role or AAL1 access;
- legal-work and submission attempts before payment clearance;
- override without permission, MFA, sufficient reason or valid expiry;
- integration/provider outage and controlled manual exception ownership.

Novel scenarios must be recorded as lifecycle exceptions with owner, severity,
due date, escalation and audited resolution. They must never silently bypass
payment, legal, compliance or tenant controls.
