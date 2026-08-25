import { expect, test, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";

const email = process.env.E2E_CASE_USER_EMAIL;
const password = process.env.E2E_CASE_USER_PASSWORD;
const totpSecret = process.env.E2E_CASE_USER_TOTP_SECRET;
const testEmail = process.env.E2E_GATE_L_RECIPIENT_EMAIL;
const testPhone = process.env.E2E_GATE_L_RECIPIENT_PHONE;
const requireLive = process.env.REQUIRE_LIVE_GATE_L === "1";

type WorkspaceUser = {
  organisations: Array<{
    organisationId: string;
    organisationStatus: string;
    permissions: string[];
  }>;
};

type Communications = {
  conversations: Array<{
    id: string;
    subject: string;
    messages: Array<{ id: string; status: string }>;
  }>;
  liveOperations: {
    providerConnections: Array<{
      connectionId: string;
      provider: string;
      state: string;
      capabilities: string[];
    }>;
  };
};

function secret(value: string): string {
  const normalised = value.replace(/[\s-]/g, "").toUpperCase();
  if (normalised.length < 16 || !/^[A-Z2-7]+=*$/.test(normalised)) {
    throw new Error("E2E_CASE_USER_TOTP_SECRET is not valid Base32.");
  }
  return normalised;
}

async function signIn(page: Page): Promise<void> {
  if (!email || !password || !totpSecret) {
    throw new Error("Dedicated AAL2 Gate L credentials are required.");
  }
  await page.goto("/login?returnTo=%2Fcommunications");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(communications|mfa\/challenge)/, {
    timeout: 20_000,
  });
  if (new URL(page.url()).pathname === "/mfa/challenge") {
    const remaining = 30_000 - (Date.now() % 30_000);
    if (remaining < 5_000) await page.waitForTimeout(remaining + 300);
    const code = new OTPAuth.TOTP({
      issuer: "BusinessOS",
      label: email,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret(totpSecret)),
    }).generate();
    await page.getByLabel("Verification code").fill(code);
    await page.getByRole("button", { name: "Verify and continue" }).click();
  }
  await expect(page).toHaveURL(/\/communications/, { timeout: 20_000 });
}

async function organisation(page: Page) {
  const response = await page.request.get("/api/auth/me");
  const user = (await response.json()) as WorkspaceUser;
  return user.organisations.find((entry) => {
    const permissions = new Set(
      entry.permissions.map((item) => item.toLowerCase()),
    );
    return (
      entry.organisationStatus.toUpperCase() === "ACTIVE" &&
      permissions.has("communications.read") &&
      permissions.has("communications.send")
    );
  });
}

async function mutate(
  page: Page,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return page.evaluate(async (input) => {
    const response = await fetch("/api/communications/mutations", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    };
  }, payload);
}

test.describe("Gate L live operations", () => {
  test("loads the compact governed workspace and rejects another tenant", async ({
    page,
  }) => {
    test.skip(
      (!email || !password || !totpSecret) && !requireLive,
      "Dedicated Gate L credentials are not configured.",
    );
    await signIn(page);
    const org = await organisation(page);
    if (!org)
      throw new Error("The Gate L user lacks an active communications role.");

    await expect(
      page.getByRole("heading", { name: "Communications & calendar" }),
    ).toBeVisible({ timeout: 30_000 });
    for (const tab of ["Inbox", "Calendar", "Connections", "Client tools"]) {
      await expect(page.getByRole("tab", { name: tab })).toBeVisible();
    }
    await expect(page.locator("body")).not.toContainText(
      /(?:clientSecret|refreshToken|accessToken|sk-proj-)/i,
    );
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
    );
    expect(overflow).toBe(false);

    const own = await page.request.get(
      `/api/communications?${new URLSearchParams({ organisationId: org.organisationId })}`,
    );
    expect(own.status(), await own.text()).toBe(200);
    expect(own.headers()["cache-control"]).toContain("no-store");
    const foreign = await page.request.get(
      `/api/communications?${new URLSearchParams({ organisationId: crypto.randomUUID() })}`,
    );
    expect(foreign.status()).toBe(403);
  });

  test("sends through real email and WhatsApp and creates then cancels a real appointment", async ({
    page,
  }) => {
    test.skip(!requireLive, "Live Gate L provider acceptance is not required.");
    if (!testEmail || !testPhone) {
      throw new Error(
        "REQUIRE_LIVE_GATE_L=1 requires E2E_GATE_L_RECIPIENT_EMAIL and E2E_GATE_L_RECIPIENT_PHONE.",
      );
    }
    test.setTimeout(180_000);
    await signIn(page);
    const org = await organisation(page);
    if (!org)
      throw new Error("The Gate L user lacks an active communications role.");
    const query = new URLSearchParams({ organisationId: org.organisationId });
    const communicationsResponse = await page.request.get(
      `/api/communications?${query.toString()}`,
    );
    const communications =
      (await communicationsResponse.json()) as Communications;
    const emailConnection =
      communications.liveOperations.providerConnections.find(
        (item) => item.state === "READY" && item.capabilities.includes("EMAIL"),
      );
    const whatsappConnection =
      communications.liveOperations.providerConnections.find(
        (item) =>
          item.state === "READY" &&
          item.provider === "WHATSAPP_BUSINESS" &&
          item.capabilities.includes("WHATSAPP"),
      );
    const calendarConnection =
      communications.liveOperations.providerConnections.find(
        (item) =>
          item.state === "READY" && item.capabilities.includes("CALENDAR"),
      );
    if (!emailConnection || !whatsappConnection || !calendarConnection) {
      throw new Error(
        "Live acceptance requires READY email, WhatsApp and calendar connections.",
      );
    }
    const optionsResponse = await page.request.get(
      `/api/case-management?${new URLSearchParams({
        organisationId: org.organisationId,
        resource: "options",
        page: "1",
        limit: "100",
      })}`,
    );
    const options = (await optionsResponse.json()) as {
      clients: Array<{ id: string }>;
    };
    const clientId = options.clients[0]?.id;
    if (!clientId)
      throw new Error(
        "A dedicated test client is required for Gate L acceptance.",
      );
    const marker = `gate-l-${Date.now()}`;

    for (const delivery of [
      {
        channel: "EMAIL",
        connectionId: emailConnection.connectionId,
        recipient: testEmail,
      },
      {
        channel: "WHATSAPP",
        connectionId: whatsappConnection.connectionId,
        recipient: testPhone,
      },
    ]) {
      const conversation = await mutate(page, {
        operation: "conversation.create",
        organisationId: org.organisationId,
        payload: {
          clientId,
          channel: delivery.channel,
          integrationConnectionId: delivery.connectionId,
          subject: `[Gate L acceptance] ${marker}`,
        },
      });
      expect(conversation.status, JSON.stringify(conversation.body)).toBe(201);
      const conversationId = String(conversation.body.id);
      const message = await mutate(page, {
        operation: "message.send",
        organisationId: org.organisationId,
        conversationId,
        payload: {
          subject: `[Gate L acceptance] ${marker}`,
          bodyText: `BusinessOS Gate L acceptance evidence ${marker}.`,
          recipientAddresses: [delivery.recipient],
          idempotencyKey: `${marker}/${delivery.channel.toLowerCase()}`,
        },
      });
      expect(message.status, JSON.stringify(message.body)).toBe(201);
    }

    const startsAt = new Date(Date.now() + 26 * 60 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);
    const created = await mutate(page, {
      operation: "calendar.create",
      organisationId: org.organisationId,
      payload: {
        integrationConnectionId: calendarConnection.connectionId,
        clientId,
        title: `[Gate L acceptance] ${marker}`,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        timezone: "Europe/London",
        attendeeAddresses: [testEmail],
        reminderMinutesBefore: 15,
        idempotencyKey: `${marker}/calendar`,
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.status).toBe("SCHEDULED");
    const cancelled = await mutate(page, {
      operation: "calendar.cancel",
      organisationId: org.organisationId,
      eventId: created.body.id,
      payload: {
        reason: "Automated Gate L acceptance cleanup.",
        expectedVersion: created.body.version,
      },
    });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(cancelled.body.status).toBe("CANCELLED");

    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `/api/communications?${query.toString()}`,
          );
          const latest = (await response.json()) as Communications;
          const messages = latest.conversations
            .filter((conversation) => conversation.subject.includes(marker))
            .flatMap((conversation) => conversation.messages);
          return (
            messages.length === 2 &&
            messages.every((message) =>
              ["SENT", "DELIVERED", "READ"].includes(message.status),
            )
          );
        },
        { timeout: 90_000, intervals: [2_000, 5_000] },
      )
      .toBe(true);
  });
});
