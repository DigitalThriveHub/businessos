# BusinessOS universal intake connectors

All external systems ultimately call the same signed HTTPS contract:

`POST /api/v1/webhooks/intake/{connectionId}`

This makes BusinessOS independent of website technology. WordPress, Elementor,
PHP, Laravel, Symfony, Node.js, Next.js, React server actions, Python, .NET,
Java, Google Forms and Meta Lead Ads all normalise their source data into the
same canonical enquiry payload.

Never sign requests in public browser JavaScript. Browser forms must submit to
their own server, a serverless function, or a hosted BusinessOS form. Store the
BusinessOS signing secret in a production secret manager.

Reference implementations:

- `php/businessos-intake.php`: framework-neutral PHP 8.1+ sender.
- `javascript/businessos-intake.mjs`: Node.js 20+ sender.
- `wordpress/businessos-intake.php`: WordPress REST endpoint and Elementor hook.
- `google-forms/Code.gs`: Google Apps Script form-submit adapter.
- `meta-lead-ads/handler.mjs`: complete Meta webhook challenge/signature
  verification, Graph lead retrieval, canonical mapping and idempotent relay.

Any platform capable of an outbound HTTPS call can use the PHP or JavaScript
sender directly, including Laravel, Symfony, Drupal, Joomla, Magento, Shopify
server functions, Webflow automations, Wix/Velo, Squarespace extensions,
Zapier, Make, Power Automate, n8n, Salesforce, HubSpot and bespoke systems.
The transport is technology-neutral; a new BusinessOS endpoint is not required
for each website product.

Each adapter must provide the locked privacy fields, a unique provider event ID,
and a current Unix timestamp. BusinessOS rejects stale, replayed, tampered,
oversized or consent-incomplete submissions.
