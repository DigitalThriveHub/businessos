import { createHmac, timingSafeEqual } from "node:crypto";

import { sendBusinessOSEnquiry } from "../javascript/businessos-intake.mjs";

const DEFAULT_GRAPH_VERSION = "v24.0";

function required(config, key) {
  const value = config[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing Meta connector configuration: ${key}.`);
  }
  return value.trim();
}

export function verifyMetaSignature(rawBody, supplied, appSecret) {
  if (!Buffer.isBuffer(rawBody) || !supplied?.startsWith("sha256=")) return false;
  const expected = Buffer.from(
    createHmac("sha256", appSecret).update(rawBody).digest("hex"),
    "ascii",
  );
  const actual = Buffer.from(supplied.slice(7), "ascii");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function fieldMap(fieldData) {
  const result = new Map();
  for (const field of Array.isArray(fieldData) ? fieldData : []) {
    if (typeof field?.name !== "string" || !Array.isArray(field.values)) continue;
    result.set(field.name.toLowerCase(), String(field.values[0] ?? "").trim());
  }
  return result;
}

function firstValue(fields, names) {
  for (const name of names) {
    const value = fields.get(name);
    if (value) return value;
  }
  return undefined;
}

export function normaliseMetaLead(lead, config) {
  const fields = fieldMap(lead?.field_data);
  const fullName = firstValue(fields, ["full_name", "name"]);
  const nameParts = fullName?.split(/\s+/) ?? [];
  const firstName =
    firstValue(fields, ["first_name", "first name"]) ?? nameParts.shift();
  const lastName =
    firstValue(fields, ["last_name", "last name"]) ??
    (nameParts.length ? nameParts.join(" ") : undefined);
  const email = firstValue(fields, ["email", "email_address"]);
  const phone = firstValue(fields, ["phone_number", "phone", "mobile_number"]);
  if (!firstName || (!email && !phone)) {
    throw new Error("The Meta lead is missing a name or contact method.");
  }

  return {
    firstName,
    ...(lastName ? { lastName } : {}),
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    ...(firstValue(fields, ["country", "country_name"])
      ? { country: firstValue(fields, ["country", "country_name"]) }
      : {}),
    serviceType:
      firstValue(fields, ["service_type", "service_required", "product_service"]) ??
      config.defaultServiceType ??
      "Facebook Lead Ad",
    message:
      firstValue(fields, ["message", "how_can_we_help", "additional_information"]) ??
      `Meta Lead Ad form ${lead.form_id ?? "unknown"}`,
    priority: "NORMAL",
    lawfulBasis: config.lawfulBasis ?? "CONSENT",
    privacyNoticeAcknowledged: true,
    privacyNoticeVersion: required(config, "privacyNoticeVersion"),
    marketingConsent: Boolean(config.marketingConsent),
    ...(config.marketingConsent
      ? { marketingConsentCapturedAt: lead.created_time ?? new Date().toISOString() }
      : {}),
  };
}

export async function fetchMetaLead(leadgenId, config, fetchImpl = fetch) {
  const graphVersion = config.graphVersion ?? DEFAULT_GRAPH_VERSION;
  if (!/^v\d+\.\d+$/.test(graphVersion)) throw new Error("Invalid Meta Graph version.");
  const url = new URL(
    `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(leadgenId)}`,
  );
  url.searchParams.set(
    "fields",
    "id,created_time,field_data,form_id,ad_id,adgroup_id,campaign_id",
  );
  url.searchParams.set("access_token", required(config, "pageAccessToken"));
  const response = await fetchImpl(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json();
  if (!response.ok || body?.error) {
    throw new Error(`Meta lead retrieval failed (${response.status}).`);
  }
  return body;
}

export async function relayMetaLead(lead, leadgenId, config) {
  return sendBusinessOSEnquiry(normaliseMetaLead(lead, config), {
    apiUrl: required(config, "businessosApiUrl"),
    connectionId: required(config, "businessosConnectionId"),
    signingSecret: required(config, "businessosSigningSecret"),
    eventId: `meta:${leadgenId}`,
    eventType: "meta.leadgen.created",
  });
}

function webhookChanges(payload) {
  const results = [];
  for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (change?.field === "leadgen" && typeof change?.value?.leadgen_id === "string") {
        results.push(change.value);
      }
    }
  }
  return results;
}

// Provider-neutral Fetch API handler for Node 20+ and serverless runtimes.
// Meta and BusinessOS secrets stay in the runtime secret store.
export function createMetaLeadAdsHandler(config, fetchImpl = fetch) {
  return async function handle(request) {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const valid =
        url.searchParams.get("hub.mode") === "subscribe" &&
        url.searchParams.get("hub.verify_token") === required(config, "verifyToken");
      return new Response(valid ? url.searchParams.get("hub.challenge") ?? "" : "Forbidden", {
        status: valid ? 200 : 403,
        headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
      });
    }
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const rawBody = Buffer.from(await request.arrayBuffer());
    if (rawBody.length === 0 || rawBody.length > 1_048_576) {
      return new Response("Invalid payload", { status: 400 });
    }
    if (!verifyMetaSignature(
      rawBody,
      request.headers.get("x-hub-signature-256"),
      required(config, "appSecret"),
    )) {
      return new Response("Invalid signature", { status: 401 });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    if (payload.object !== "page") return new Response("Ignored", { status: 202 });
    for (const change of webhookChanges(payload)) {
      const lead = await fetchMetaLead(change.leadgen_id, config, fetchImpl);
      await relayMetaLead(lead, change.leadgen_id, config);
    }
    return new Response("Accepted", {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  };
}
