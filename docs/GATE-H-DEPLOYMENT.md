# Gate H deployment

## Secrets and boundaries

- Keep `INTEGRATION_SIGNING_MASTER_SECRET` only in the API secret manager.
- Store each one-time derived connection secret only in the external system's
  server-side secret store. Never expose it in HTML or browser JavaScript.
- Store Meta Page access tokens and app secrets in the relay runtime's secret
  manager. Grant only the pages and lead permissions actually required.
- Use HTTPS origins. Local HTTP is accepted only for localhost development.
- Rotate a BusinessOS connection secret after suspected disclosure; the prior
  secret stops authenticating immediately.

## Public BusinessOS forms

Create a non-Stripe active intake connection, create the form, enter the exact
website origin (scheme, hostname and port only), review the privacy-notice URL
and version, then publish. Use `/forms/{publicId}` as the hosted URL. Embedded
sites post through their own server or the hosted BusinessOS form; they never
receive a signing secret.

## External connectors

- PHP 8.1+: `connectors/php/businessos-intake.php`
- Node.js 20+: `connectors/javascript/businessos-intake.mjs`
- WordPress/Elementor/CF7/WPForms/Gravity:
  `connectors/wordpress/businessos-intake.php`
- Google Forms: `connectors/google-forms/Code.gs`
- Meta Lead Ads: `connectors/meta-lead-ads/handler.mjs`

Every source maps to the same canonical, bounded payload and sends a unique
provider event ID. The API stores hashes, correlation IDs and audit evidence,
not arbitrary raw source payloads.

## Release sequence

1. Deploy the API and web artifacts from the same immutable commit.
2. Apply `20260824100000_universal_intake_and_matching.sql`.
3. Run the Gate H verification with live credentials and no skips.
4. Exercise each configured external provider on staging.
5. Review quarantine, unmatched communication and failed-delivery queues.
6. Capture the release SHA, database migration version and acceptance times.
7. Enable production traffic gradually and monitor provider failures, 4xx/5xx
   rates, queue age and duplicate/quarantine trends.

Rollback disables forms and integration connections before rolling application
traffic back. The migration is additive and evidence tables are retained; do
not delete audit, intake or communication records during rollback.
