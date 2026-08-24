import { createHmac, randomUUID } from "node:crypto";

export async function sendBusinessOSEnquiry(payload, config) {
  const body = JSON.stringify(payload);
  const eventId = config.eventId ?? randomUUID();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", config.signingSecret)
    .update(`${timestamp}.${eventId}.${body}`)
    .digest("hex");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(
      `${config.apiUrl.replace(/\/$/, "")}/api/v1/webhooks/intake/${encodeURIComponent(config.connectionId)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-BusinessOS-Event-Id": eventId,
          "X-BusinessOS-Event-Type": config.eventType ?? "enquiry.submitted",
          "X-BusinessOS-Timestamp": timestamp,
          "X-BusinessOS-Signature": `v1=${signature}`,
        },
        body,
        signal: controller.signal,
      },
    );
    if (!response.ok) throw new Error(`BusinessOS rejected the submission (${response.status}).`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}
