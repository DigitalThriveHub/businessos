=== BusinessOS Secure Intake ===
Contributors: businessos
Tags: enquiry, crm, secure forms, businessos
Requires at least: 6.4
Requires PHP: 8.1
Stable tag: 1.0.0
License: Proprietary

Server-side signed enquiry intake for BusinessOS. No signing secret is exposed
to the browser and no enquiry payload is retained by the plugin.

== Installation ==

1. Copy the businessos-secure-intake folder to wp-content/plugins/.
2. Add the configuration constants shown below to wp-config.php above the
   "stop editing" line.
3. Activate BusinessOS Secure Intake in WordPress.
4. Add [businessos_enquiry_form] to the required page.
5. Put that page behind managed bot/WAF protection and test it in staging.

Before production activation, run `php -l businessos-secure-intake.php` with
the same PHP major/minor version used by the WordPress host.

Example wp-config.php values:

define('BUSINESSOS_INTAKE_API_URL', 'https://api.example.co.uk');
define('BUSINESSOS_INTAKE_CONNECTION_ID', '00000000-0000-4000-8000-000000000000');
define('BUSINESSOS_INTAKE_SIGNING_SECRET', 'paste-the-one-time-secret-here');
define('BUSINESSOS_PRIVACY_NOTICE_URL', 'https://www.example.co.uk/privacy');
define('BUSINESSOS_PRIVACY_NOTICE_VERSION', '2026-08');
define('BUSINESSOS_INTAKE_LAWFUL_BASIS', 'LEGITIMATE_INTEREST');

The lawful basis must be selected and documented by the organisation. Allowed
technical values are CONSENT, CONTRACT, LEGAL_OBLIGATION and
LEGITIMATE_INTEREST. Marketing consent is always captured separately.

== Security ==

Keep wp-config.php outside the public web root where the host supports it.
Never place the signing secret in a page builder, JavaScript, WordPress option,
support ticket or screenshot. Rotate it from BusinessOS after suspected
disclosure. Keep WordPress, PHP, plugins and the operating system patched.

The plugin uses WordPress nonces, a honeypot, server-side HMAC-SHA256,
timestamp validation at BusinessOS, per-origin throttling, HTTPS-only safe HTTP
requests and idempotent event IDs. It intentionally does not log or persist
submitted personal data.

For a tailored form:

[businessos_enquiry_form service_type="Immigration" button_label="Request a consultation"]
