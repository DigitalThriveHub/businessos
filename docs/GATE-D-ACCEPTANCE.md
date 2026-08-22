# Gate D acceptance record

Record evidence for each environment. A checked box must link to logs, screenshots, test output or an approved control record.

## Automated gates

- [ ] Prisma format, validate and generate pass.
- [ ] Every API unit suite passes with zero failures.
- [ ] API production build passes.
- [ ] Web lint passes with zero warnings/errors.
- [ ] Web production build passes.
- [ ] All five critical Playwright specifications compile.
- [ ] Supabase dry-run lists only the two expected Gate D migrations.
- [ ] Local and remote migration histories match after application.
- [ ] Critical Playwright run passes; environment-controlled skips are documented.
- [ ] `-RequireLiveGateD` passes with a dedicated staging portal client.

## Security and privacy gates

- [ ] Portal and workforce invitation secrets are different and stored in a secret manager.
- [ ] Sending domain is verified and DMARC/SPF/DKIM policy is reviewed.
- [ ] Resend webhook signatures reject altered payloads.
- [ ] Client access is exact-email, scoped, revocable and denied after revocation.
- [ ] Cross-tenant record guesses disclose no data.
- [ ] Benign files become available only after `CLEAN` scan results.
- [ ] EICAR stays quarantined and unavailable.
- [ ] No `.env`, private key, TOTP seed, invitation token or provider credential is committed.
- [ ] Backup restore, disaster recovery and incident-response exercises have evidence.
- [ ] DPIA, retention, supplier and access-review controls have owners and approval dates.

## Release decision

- Environment:
- Release owner:
- Security approver:
- Data-protection approver:
- Date/time (UTC):
- Migration IDs:
- Test-report location:
- Known limitations accepted:
- Go/no-go decision:
