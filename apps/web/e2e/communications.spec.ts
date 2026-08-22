import { expect, test, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";

const email = process.env.E2E_CASE_USER_EMAIL;
const password = process.env.E2E_CASE_USER_PASSWORD;
const totpSecret = process.env.E2E_CASE_USER_TOTP_SECRET;

type WorkspaceUser = {
  organisations: Array<{
    organisationId: string;
    organisationStatus: string;
    permissions: string[];
  }>;
};

type ClientRecord = { id: string; version: number };
type MatterRecord = { id: string; version: number };

function normaliseSecret(value: string): string {
  const secret = value.replace(/[\s-]/g, "").toUpperCase();
  if (secret.length < 16 || !/^[A-Z2-7]+=*$/.test(secret)) {
    throw new Error("E2E_CASE_USER_TOTP_SECRET is not valid Base32.");
  }
  return secret;
}

async function signIn(page: Page): Promise<void> {
  if (!email || !password || !totpSecret) throw new Error("Gate D E2E credentials are required.");
  await page.goto("/login?returnTo=%2Fcommunications");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(communications|mfa\/challenge)/, { timeout: 20_000 });
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
  await expect(page).toHaveURL(/\/communications/, { timeout: 20_000 });
}

async function post<T>(page: Page, route: string, body: unknown): Promise<T> {
  const response = await page.request.post(route, {
    headers: { Origin: new URL(page.url()).origin, "Content-Type": "application/json" },
    data: body,
  });
  const text = await response.text();
  expect(response.ok(), text).toBe(true);
  return JSON.parse(text) as T;
}

test.describe("Gate D communications", () => {
  test("runs an authenticated portal-message and tenant-isolation workflow", async ({ page }) => {
    test.skip(!email || !password || !totpSecret, "Dedicated AAL2 Gate D credentials are not configured.");
    test.setTimeout(90_000);
    await signIn(page);

    const meResponse = await page.request.get("/api/auth/me");
    expect(meResponse.status()).toBe(200);
    const user = (await meResponse.json()) as WorkspaceUser;
    const required = [
      "clients.create",
      "clients.archive",
      "matters.create",
      "matters.status.manage",
      "communications.read",
      "communications.send",
    ];
    const organisation = user.organisations.find((entry) => {
      const granted = new Set(entry.permissions.map((permission) => permission.toLowerCase()));
      return entry.organisationStatus.toUpperCase() === "ACTIVE" && required.every((permission) => granted.has(permission));
    });
    test.skip(!organisation, "The Gate D E2E role is incomplete.");
    if (!organisation) throw new Error("Gate D E2E organisation is missing.");

    const unique = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    let client: ClientRecord | null = null;
    let matter: MatterRecord | null = null;

    try {
      client = await post<ClientRecord>(page, "/api/case-management/mutations", {
        operation: "client.create",
        organisationId: organisation.organisationId,
        payload: {
          kind: "INDIVIDUAL",
          firstName: `GateD-${unique}`,
          lastName: "Playwright",
          email: `gate-d-${unique}@example.test`,
          processingLawfulBasis: "CONTRACT",
          preferredLanguage: "en-GB",
          preferredCommunication: "EMAIL",
        },
      });
      matter = await post<MatterRecord>(page, "/api/case-management/mutations", {
        operation: "matter.create",
        organisationId: organisation.organisationId,
        payload: {
          primaryClientId: client.id,
          title: `Gate D communication ${unique}`,
          serviceType: "Secure communications E2E",
          jurisdictionCountryCode: "GB",
          priority: "NORMAL",
        },
      });
      const conversation = await post<{ id: string }>(page, "/api/communications/mutations", {
        operation: "conversation.create",
        organisationId: organisation.organisationId,
        payload: {
          clientId: client.id,
          matterId: matter.id,
          channel: "PORTAL",
          subject: `Secure update ${unique}`,
        },
      });
      await post(page, "/api/communications/mutations", {
        operation: "message.send",
        organisationId: organisation.organisationId,
        conversationId: conversation.id,
        payload: {
          subject: `Secure update ${unique}`,
          bodyText: "This message is visible only through authorised portal access.",
          recipientAddresses: [],
          idempotencyKey: `gate-d-e2e/${unique}`,
        },
      });

      await page.goto("/communications");
      await expect(page.getByRole("heading", { name: "Communications", exact: true })).toBeVisible();
      await expect(page.getByText(`Secure update ${unique}`, { exact: true })).toBeVisible({ timeout: 20_000 });

      const foreign = await page.request.get(
        `/api/communications?${new URLSearchParams({ organisationId: crypto.randomUUID() }).toString()}`,
      );
      expect(foreign.status()).toBe(403);
      expect(foreign.headers()["cache-control"]).toContain("no-store");
    } finally {
      if (matter) {
        const cancelled = await post<MatterRecord>(page, "/api/case-management/mutations", {
          operation: "matter.status",
          organisationId: organisation.organisationId,
          matterId: matter.id,
          payload: { toStatus: "CANCELLED", reason: "Gate D E2E cleanup.", outcome: "Verified.", expectedVersion: matter.version },
        });
        await post(page, "/api/case-management/mutations", {
          operation: "matter.status",
          organisationId: organisation.organisationId,
          matterId: matter.id,
          payload: { toStatus: "ARCHIVED", reason: "Gate D E2E cleanup.", outcome: null, expectedVersion: cancelled.version },
        });
      }
      if (client) {
        await post(page, "/api/case-management/mutations", {
          operation: "client.archive",
          organisationId: organisation.organisationId,
          clientId: client.id,
          payload: { reason: "Gate D E2E cleanup.", expectedVersion: client.version },
        });
      }
    }
  });
});
