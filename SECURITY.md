# Security policy

## Reporting a vulnerability

Do not open a public issue containing vulnerability details, credentials,
personal data or production evidence. Report privately to the security contact
configured for the deployed organisation. Include the affected release, route
or component, reproducible impact, prerequisites and a safe proof of concept.

The production owner must acknowledge reports according to its incident-response
SLA, triage severity, preserve evidence, assess personal-data impact, coordinate
remediation and retest, and record any required notification decision in the
Assurance centre.

## Supported releases

Only the currently deployed immutable release and the immediately previous
rollback image are supported. Dependencies and container bases are monitored by
Dependabot, CodeQL and the organisation's approved vulnerability/container
scanner. Automated scanning supplements but does not replace independent review.

## Credential safety

Never send keys or passwords in chat, screenshots, issues, logs or source. If a
credential is exposed, revoke and replace it; deleting the message is not
rotation. Store runtime credentials in the hosting provider's managed secret
store and use separate projects/accounts and least privilege per environment.
