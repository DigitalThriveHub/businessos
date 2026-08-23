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
  status: "ACTIVE" | "DISABLED";
  signingSecret?: string;
  version: number;
};

function normaliseSecret(value: string): string {
  const secret = value.replace(/[\s-]/g, "").toUpperCase();
  if (secret.length < 16 || !/^[A-Z2-7]+=*$/.test(secret)) {
    throw new Error("E2E_CASE_USER_TOTP_SECRET is not valid Base32.");
  }
  return secret;
}

async function signIn(page: Page): Promise<void> {
  if (!email || !password || !totpSecret) {
    throw new Error("Dedicated AAL2 Gate F credentials are required.");
  }
  await page.goto("/login?returnTo=%2Fintegrations");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(integrations|mfa\/challenge)/, {
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

test.describe("Gate F integrations and command centre", () => {
  test("ingests a signed lead, rejects replay across tenants and reports operational evidence", async ({
    page,
  }) => {
    test.skip(
      !email || !password || !totpSecret,
      "Dedicated AAL2 Gate F credentials are not configured.",
    );
    test.setTimeout(120_000);
    await signIn(page);

    const me = await page.request.get("/api/auth/me");
    expect(me.status()).toBe(200);
    const user = (await me.json()) as WorkspaceUser;
    const required = [
      "integrations.read",
      "integrations.manage",
      "command_centre.read",
      "enquiries.read_all",
      "enquiries.delete",
    ];
    const organisation = user.organisations.find((entry) => {
      const permissions = new Set(
        entry.permissions.map((permission) => permission.toLowerCase()),
      );
      return (
        entry.organisationStatus.toUpperCase() === "ACTIVE" &&
        required.every((permission) => permissions.has(permission))
      );
    });
    test.skip(!organisation, "The Gate F E2E role is incomplete.");
    if (!organisation) throw new Error("Gate F organisation is missing.");

    const unique = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    let connection: Connection | null = null;
    let enquiryId: string | null = null;

    try {
      connection = await post<Connection>(page, "/api/integrations/mutations", {
        operation: "connection.create",
        organisationId: organisation.organisationId,
        payload: {
          provider: "GENERIC",
          displayName: `Gate F signed intake ${unique}`,
        },
      });
      expect(connection.signingSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const eventId = `gate-f/intake/${unique}`;
      const eventType = "enquiry.created";
      const timestamp = String(Math.floor(Date.now() / 1_000));
      const payload = JSON.stringify({
        firstName: `GateF-${unique}`,
        lastName: "SignedIntake",
        email: `gate-f-${unique}@example.test`,
        country: "United Kingdom",
        serviceType: "Immigration",
        message: "Signed Gate F acceptance evidence.",
        priority: "HIGH",
        lawfulBasis: "LEGITIMATE_INTEREST",
        privacyNoticeAcknowledged: true,
        privacyNoticeVersion: "2026-08",
        marketingConsent: false,
      });
      const signature = createHmac("sha256", connection.signingSecret!)
        .update(timestamp)
        .update(".")
        .update(eventId)
        .update(".")
        .update(payload)
        .digest("hex");

      const first = await fetch(
        `${apiBaseUrl}/api/v1/webhooks/intake/${connection.id}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-businessos-event-id": eventId,
            "x-businessos-event-type": eventType,
            "x-businessos-timestamp": timestamp,
            "x-businessos-signature": `v1=${signature}`,
          },
          body: payload,
        },
      );
      const firstText = await first.text();
      expect(first.ok, firstText).toBe(true);
      const accepted = JSON.parse(firstText) as {
        accepted: true;
        duplicate: boolean;
        enquiryId: string;
      };
      expect(accepted).toMatchObject({ accepted: true, duplicate: false });
      enquiryId = accepted.enquiryId;

      const replay = await fetch(
        `${apiBaseUrl}/api/v1/webhooks/intake/${connection.id}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-businessos-event-id": eventId,
            "x-businessos-event-type": eventType,
            "x-businessos-timestamp": timestamp,
            "x-businessos-signature": `v1=${signature}`,
          },
          body: payload,
        },
      );
      const replayText = await replay.text();
      expect(replay.ok, replayText).toBe(true);
      expect(JSON.parse(replayText)).toMatchObject({
        accepted: true,
        duplicate: true,
        enquiryId,
      });

      await page.goto("/integrations");
      await expect(
        page.getByRole("heading", { name: "Integrations", exact: true }),
      ).toBeVisible();
      await expect(page.getByText(eventType, { exact: true })).toBeVisible({
        timeout: 20_000,
      });

      await page.goto("/command-centre");
      await expect(
        page.getByRole("heading", { name: "Command Centre", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("New enquiries", { exact: true }),
      ).toBeVisible();

      for (const route of ["/api/integrations", "/api/command-centre"]) {
        const foreign = await page.request.get(
          `${route}?${new URLSearchParams({
            organisationId: crypto.randomUUID(),
          }).toString()}`,
        );
        expect(foreign.status()).toBe(403);
        expect(foreign.headers()["cache-control"]).toContain("no-store");
      }
    } finally {
      if (connection) {
        const dashboardResponse = await page.request.get(
          `/api/integrations?${new URLSearchParams({
            organisationId: organisation.organisationId,
          }).toString()}`,
        );
        if (dashboardResponse.ok()) {
          const dashboard = (await dashboardResponse.json()) as {
            connections: Connection[];
          };
          const current = dashboard.connections.find(
            (item) => item.id === connection?.id,
          );
          if (current?.status === "ACTIVE") {
            await post(page, "/api/integrations/mutations", {
              operation: "connection.status",
              organisationId: organisation.organisationId,
              connectionId: current.id,
              payload: {
                status: "DISABLED",
                expectedVersion: current.version,
              },
            });
          }
        }
      }
      if (enquiryId) {
        const cleanup = await page.request.delete(
          `/api/enquiries/${enquiryId}?${new URLSearchParams({
            organisationId: organisation.organisationId,
          }).toString()}`,
        );
        expect(cleanup.status()).toBe(204);
      }
    }
  });
});
