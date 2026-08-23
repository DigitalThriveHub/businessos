# Gate F signed intake contract

## Endpoint

`POST /api/v1/webhooks/intake/{connectionId}`

The connection must be active and have provider `WORDPRESS` or `GENERIC`.
Create it from **Integrations** while signed in with AAL2 and the
`integrations.manage` permission. The signing secret is shown once.

## Headers

| Header | Rule |
|---|---|
| `Content-Type` | `application/json` |
| `x-businessos-event-id` | Stable unique sender event ID, 8–240 characters |
| `x-businessos-event-type` | Event type such as `enquiry.created`, 3–160 characters |
| `x-businessos-timestamp` | Current Unix timestamp in seconds, exactly 10 digits |
| `x-businessos-signature` | `v1=` followed by the lowercase hex HMAC-SHA256 |

The signed bytes are exactly:

`timestamp + "." + eventId + "." + rawRequestBody`

Generate the signature using the one-time connection secret. Do not parse and
re-serialize the JSON after signing. Send the identical UTF-8 bytes. Default
timestamp tolerance is 300 seconds.

## Payload

```json
{
  "firstName": "Ada",
  "lastName": "Lovelace",
  "email": "ada@example.co.uk",
  "phone": "+447700900000",
  "country": "United Kingdom",
  "serviceType": "Immigration",
  "message": "I need advice.",
  "priority": "NORMAL",
  "lawfulBasis": "CONSENT",
  "privacyNoticeAcknowledged": true,
  "privacyNoticeVersion": "2026-08",
  "marketingConsent": false
}
```

At least one of `email` or `phone` is required. If `marketingConsent` is true,
also send an ISO-8601 `marketingConsentCapturedAt`. Operational follow-up
lawful basis and marketing consent are separate controls.

## Idempotency and privacy

Re-sending the same event ID to the same connection returns the original result
without creating a second enquiry. BusinessOS retains the event identity,
SHA-256 payload digest, correlation ID and processing outcome, but not the raw
webhook payload or signing secret.

Rotate the secret immediately after suspected disclosure. The old secret stops
working as soon as the connection secret version changes.
