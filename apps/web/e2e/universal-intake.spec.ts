import { createHmac } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";

const email = process.env.E2E_CASE_USER_EMAIL;
const password = process.env.E2E_CASE_USER_PASSWORD;
const totpSecret = process.env.E2E_CASE_USER_TOTP_SECRET;
const apiBaseUrl = (
  process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:4000"
).replace(/\/$/, "");

type WorkspaceUser = {
  organisations: Array<{
    organisationId: string;
    organisationStatus: string;
    permissions: string[];
  }>;
};
type Connection = {
  id: string;
  signingSecret?: string;
  status: "ACTIVE" | "DISABLED";
  version: number;
};
type IntakeForm = {
  id: string;
  publicId: string;
  status: "DRAFT" | "ACTIVE" | "DISABLED";
  version: number;
};

function normaliseSecret(value: string): string {
  return value.replace(/[\s-]/g, "").toUpperCase();
}

async function signIn(page: Page): Promise<void> {
  if (!email || !password || !totpSecret) {
    throw new Error("Dedicated AAL2 Gate H credentials are required.");
  }
  await page.goto("/login?returnTo=%2Fintegrations");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(integrations|mfa\/challenge)/, { timeout: 20_000 });
  if (page.url().includes("mfa/challenge")) {
    const remaining = 30_000 - (Date.now() % 30_000);
    if (remaining < 5_000) await page.waitForTimeout(remaining + 300);
    const code = new OTPAuth.TOTP({
      issuer: "BusinessOS",
      label: email,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(normaliseSecret(totpSecret)),
    }).generate();
    await page.getByLabel("Verification code").fill(code);
    await page.getByRole("button", { name: "Verify and continue" }).click();
  }
  await expect(page).toHaveURL(/\/integrations/, { timeout: 20_000 });
}

async function post<T>(page: Page, route: string, body: unknown): Promise<T> {
  const response = await page.request.post(route, {
    headers: {
      Origin: new URL(page.url()).origin,
      "Content-Type": "application/json",
    },
    data: body,
  });
  const text = await response.text();
  expect(response.ok(), text).toBe(true);
  return JSON.parse(text) as T;
}

test("Gate H accepts any signed source, operates a hosted form and controls unmatched communications", async ({
  page,
}) => {
  test.skip(
    !email || !password || !totpSecret,
    "Dedicated AAL2 Gate H credentials are not configured.",
  );
  test.setTimeout(150_000);
  await signIn(page);

  const me = await page.request.get("/api/auth/me");
  expect(me.status()).toBe(200);
  const user = (await me.json()) as WorkspaceUser;
  const required = [
    "integrations.read",
    "integrations.manage",
    "communications.read",
    "communications.send",
    "enquiries.delete",
  ];
  const organisation = user.organisations.find((entry) => {
    const permissions = new Set(
      entry.permissions.map((value) => value.toLowerCase()),
    );
    return (
      entry.organisationStatus.toUpperCase() === "ACTIVE" &&
      required.every((permission) => permissions.has(permission))
    );
  });
  test.skip(!organisation, "The Gate H E2E role is incomplete.");
  if (!organisation) throw new Error("Gate H organisation is missing.");

  const unique = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const origin = new URL(page.url()).origin;
  let connection: Connection | undefined;
  let form: IntakeForm | undefined;
  let enquiryId: string | undefined;
  let queueItem: { id: string; version: number } | undefined;

  try {
    connection = await post<Connection>(page, "/api/integrations/mutations", {
      operation: "connection.create",
      organisationId: organisation.organisationId,
      payload: {
        provider: "GENERIC",
        displayName: `Gate H universal intake ${unique}`,
      },
    });
    expect(connection.signingSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);

    form = await post<IntakeForm>(page, "/api/integrations/mutations", {
      operation: "form.create",
      organisationId: organisation.organisationId,
      payload: {
        connectionId: connection.id,
        key: `gate_h_${unique.replace(/[^a-z0-9]/gi, "_").toLowerCase()}`,
        name: `Gate H hosted form ${unique}`,
        description: "Universal secure intake acceptance form.",
        privacyNoticeUrl: "https://example.test/privacy",
        privacyNoticeVersion: "2026-08",
        allowedOrigins: [origin],
        formSchema: {
          fields: [
            {
              name: "firstName",
              label: "First name",
              type: "text",
              required: true,
            },
            { name: "email", label: "Email", type: "email", required: true },
            { name: "serviceType", label: "Service", type: "text" },
            { name: "message", label: "Message", type: "textarea" },
          ],
        },
      },
    });
    form = await post<IntakeForm>(page, "/api/integrations/mutations", {
      operation: "form.status",
      organisationId: organisation.organisationId,
      formId: form.id,
      payload: { status: "ACTIVE", expectedVersion: form.version },
    });

    const publicForm = await page.request.get(
      `/api/public/forms/${form.publicId}`,
      {
        headers: { Origin: origin },
      },
    );
    expect(publicForm.status()).toBe(200);
    expect(publicForm.headers()["cache-control"]).toContain("no-store");

    const submission = {
      submissionId: `gate-h-${unique}`,
      formStartedAt: new Date(Date.now() - 2_000).toISOString(),
      firstName: `GateH-${unique}`,
      email: `gate-h-${unique}@example.test`,
      serviceType: "Universal intake",
      message: "Hosted BusinessOS form acceptance evidence.",
      lawfulBasis: "CONSENT",
      privacyNoticeAcknowledged: true,
      privacyNoticeVersion: "2026-08",
      marketingConsent: false,
    };
    const accepted = await post<{ enquiryId: string; duplicate: boolean }>(
      page,
      `/api/public/forms/${form.publicId}/submissions`,
      submission,
    );
    expect(accepted.duplicate).toBe(false);
    enquiryId = accepted.enquiryId;
    const replay = await post<{ enquiryId: string; duplicate: boolean }>(
      page,
      `/api/public/forms/${form.publicId}/submissions`,
      submission,
    );
    expect(replay).toMatchObject({ enquiryId, duplicate: true });

    const forbiddenOrigin = await fetch(
      `${apiBaseUrl}/api/v1/public/intake/forms/${form.publicId}`,
      { headers: { Origin: "https://untrusted.example" } },
    );
    expect(forbiddenOrigin.status).toBe(403);

    const communicationBody = JSON.stringify({
      channel: "EMAIL",
      providerMessageId: `provider-${unique}`,
      providerThreadId: `thread-${unique}`,
      sender: `unknown-${unique}@example.test`,
      recipients: ["intake@example.test"],
      subject: "Unmatched client message",
      body: "Please connect this message to the correct client.",
      occurredAt: new Date().toISOString(),
    });
    const communicationEventId = `gate-h/communication/${unique}`;
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const signature = createHmac("sha256", connection.signingSecret!)
      .update(`${timestamp}.${communicationEventId}.${communicationBody}`)
      .digest("hex");
    const communication = await fetch(
      `${apiBaseUrl}/api/v1/webhooks/intake/${connection.id}/communications`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-businessos-event-id": communicationEventId,
          "x-businessos-timestamp": timestamp,
          "x-businessos-signature": `v1=${signature}`,
        },
        body: communicationBody,
      },
    );
    const communicationText = await communication.text();
    expect(communication.ok, communicationText).toBe(true);
    expect(JSON.parse(communicationText)).toMatchObject({
      accepted: true,
      queuedForMatching: true,
      duplicate: false,
    });

    const communications = await page.request.get(
      `/api/communications?${new URLSearchParams({ organisationId: organisation.organisationId })}`,
    );
    const communicationsText = await communications.text();
    expect(communications.ok(), communicationsText).toBe(true);
    const dashboard = JSON.parse(communicationsText) as {
      matchQueue: Array<{
        id: string;
        version: number;
        senderIdentifier: string;
      }>;
    };
    queueItem = dashboard.matchQueue.find(
      (entry) => entry.senderIdentifier === `unknown-${unique}@example.test`,
    );
    expect(queueItem).toBeTruthy();

    const foreign = await page.request.get(
      `/api/integrations?${new URLSearchParams({ organisationId: crypto.randomUUID(), view: "gate-h" })}`,
    );
    expect(foreign.status()).toBe(403);
    expect(foreign.headers()["cache-control"]).toContain("no-store");
  } finally {
    if (queueItem) {
      await post(page, "/api/communications/mutations", {
        operation: "matching.resolve",
        organisationId: organisation.organisationId,
        queueId: queueItem.id,
        payload: {
          action: "DISMISS",
          reason: "Gate H acceptance cleanup.",
          expectedVersion: queueItem.version,
        },
      });
    }
    if (form?.status === "ACTIVE") {
      await post(page, "/api/integrations/mutations", {
        operation: "form.status",
        organisationId: organisation.organisationId,
        formId: form.id,
        payload: { status: "DISABLED", expectedVersion: form.version },
      });
    }
    if (connection?.status === "ACTIVE") {
      const currentResponse = await page.request.get(
        `/api/integrations?${new URLSearchParams({ organisationId: organisation.organisationId })}`,
      );
      if (currentResponse.ok()) {
        const current = (
          (await currentResponse.json()) as { connections: Connection[] }
        ).connections.find((entry) => entry.id === connection?.id);
        if (current?.status === "ACTIVE") {
          await post(page, "/api/integrations/mutations", {
            operation: "connection.status",
            organisationId: organisation.organisationId,
            connectionId: current.id,
            payload: { status: "DISABLED", expectedVersion: current.version },
          });
        }
      }
    }
    if (enquiryId) {
      const cleanup = await page.request.delete(
        `/api/enquiries/${enquiryId}?${new URLSearchParams({ organisationId: organisation.organisationId })}`,
      );
      expect(cleanup.status()).toBe(204);
    }
  }
});
