# Gate E acceptance record

A release is accepted only when every applicable item has retained evidence.

## Automated gates

- [ ] Prisma format, validation and generation pass.
- [ ] Every API unit suite passes with zero failures.
- [ ] API production build passes.
- [ ] Web lint and production build pass.
- [ ] Six critical Playwright specifications compile.
- [ ] Linked Supabase dry-run lists only the expected Gate E migration.
- [ ] Local and remote migration histories match after application.
- [ ] Live browser acceptance passes with zero skips.
- [ ] VAT invoice, payment allocation and balanced-journal assertions pass.
- [ ] Cross-tenant finance access returns a controlled denial with no data.

## Finance-control gates

- [ ] Legal invoice identity and address are approved.
- [ ] VAT status and VAT registration number are confirmed by finance staff.
- [ ] Invoice, credit-note and payment prefixes are approved.
- [ ] Finance roles follow least privilege and MFA is enforced for mutations.
- [ ] A credit note and refund scenario has been tested in staging.
- [ ] Journal debits equal credits for every posted event.
- [ ] Issued documents, payments, allocations and journals reject mutation/deletion.
- [ ] Client portal exposes only explicit BILLING grants for authorised matters.
- [ ] Finance retention, export and accountant hand-off procedures have owners.
- [ ] No `.env`, provider secret, TOTP seed or client data is committed.

## Release decision

- Environment:
- Release owner:
- Finance approver:
- Security approver:
- Date/time (UTC):
- Migration ID: `20260822120000`
- Test-report location:
- Known limitations accepted:
- Go/no-go decision:
