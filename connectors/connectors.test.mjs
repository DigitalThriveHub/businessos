import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

import { sendBusinessOSEnquiry } from "./javascript/businessos-intake.mjs";
import {
  normaliseMetaLead,
  verifyMetaSignature,
} from "./meta-lead-ads/handler.mjs";

test("generic JavaScript connector emits the locked BusinessOS signature contract", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const eventId = init.headers["X-BusinessOS-Event-Id"];
    const timestamp = init.headers["X-BusinessOS-Timestamp"];
    const expected = createHmac("sha256", "test-secret")
      .update(`${timestamp}.${eventId}.${init.body}`)
      .digest("hex");
    assert.equal(init.headers["X-BusinessOS-Signature"], `v1=${expected}`);
    assert.equal(init.headers["X-BusinessOS-Event-Type"], "test.form.submitted");
    return new Response(JSON.stringify({ accepted: true }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const response = await sendBusinessOSEnquiry(
      { firstName: "Ada" },
      {
        apiUrl: "https://api.example.test",
        connectionId: "11111111-1111-4111-8111-111111111111",
        signingSecret: "test-secret",
        eventId: "test-event-123",
        eventType: "test.form.submitted",
      },
    );
    assert.equal(response.accepted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Meta connector verifies signatures and maps Lead Ads fields", () => {
  const raw = Buffer.from('{"object":"page"}');
  const secret = "meta-test-secret";
  const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  assert.equal(verifyMetaSignature(raw, signature, secret), true);
  assert.equal(verifyMetaSignature(Buffer.from("tampered"), signature, secret), false);

  assert.deepEqual(
    normaliseMetaLead(
      {
        form_id: "form-123",
        created_time: "2026-08-24T08:00:00.000Z",
        field_data: [
          { name: "full_name", values: ["Ada Lovelace"] },
          { name: "email", values: ["ada@example.test"] },
          { name: "service_required", values: ["Consultation"] },
        ],
      },
      { privacyNoticeVersion: "2026-08" },
    ),
    {
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.test",
      serviceType: "Consultation",
      message: "Meta Lead Ad form form-123",
      priority: "NORMAL",
      lawfulBasis: "CONSENT",
      privacyNoticeAcknowledged: true,
      privacyNoticeVersion: "2026-08",
      marketingConsent: false,
    },
  );
});
