import { expect, test, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";

const email = process.env.E2E_PORTAL_USER_EMAIL;
const password = process.env.E2E_PORTAL_USER_PASSWORD;
const totpSecret = process.env.E2E_PORTAL_USER_TOTP_SECRET;

async function signIn(page: Page): Promise<void> {
  if (!email || !password) throw new Error("Portal E2E credentials are required.");
  await page.goto("/login?returnTo=%2Fportal");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(portal|mfa\/challenge)/, { timeout: 20_000 });
  if (new URL(page.url()).pathname === "/mfa/challenge") {
    if (!totpSecret) throw new Error("E2E_PORTAL_USER_TOTP_SECRET is required for this MFA account.");
    const remaining = 30_000 - (Date.now() % 30_000);
    if (remaining < 5_000) await page.waitForTimeout(remaining + 300);
    const code = new OTPAuth.TOTP({
      issuer: "BusinessOS",
      label: email,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(totpSecret.replace(/[\s-]/g, "").toUpperCase()),
    }).generate();
    await page.getByLabel("Verification code").fill(code);
    await page.getByRole("button", { name: "Verify and continue" }).click();
  }
  await expect(page).toHaveURL(/\/portal/, { timeout: 20_000 });
}

test.describe("Gate D client portal", () => {
  test("keeps the invitation landing page public without exposing data", async ({ page }) => {
    const token = `bop_v1_${"A".repeat(43)}`;
    await page.goto(`/portal/invitations/accept?token=${token}`);
    await expect(page.getByRole("heading", { name: "Activate secure client access" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in first" })).toHaveAttribute("href", /returnTo=/);
    await expect(page.getByRole("link", { name: "Create account" })).toHaveAttribute("href", /returnTo=/);
  });

  test("shows only the signed-in client's explicit grants", async ({ page }) => {
    test.skip(!email || !password, "A staging client with an active Gate D grant is not configured.");
    await signIn(page);
    await expect(page.getByRole("heading", { name: "Your cases" })).toBeVisible({ timeout: 20_000 });
    const response = await page.request.get("/api/client-portal");
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-store");
    const body = (await response.json()) as {
      accessGrants?: unknown[];
      matters?: unknown[];
    };
    expect(Array.isArray(body.accessGrants)).toBe(true);
    expect(body.accessGrants?.length).toBeGreaterThan(0);
    expect(Array.isArray(body.matters)).toBe(true);
    expect(body.matters?.length).toBeGreaterThan(0);

    const guessedConversation = await page.request.post(
      "/api/client-portal/mutations",
      {
        headers: {
          Origin: new URL(page.url()).origin,
          "Content-Type": "application/json",
        },
        data: {
          operation: "message.post",
          conversationId: crypto.randomUUID(),
          payload: {
            bodyText: "This must not be accepted.",
            idempotencyKey: `portal-isolation/${crypto.randomUUID()}`,
          },
        },
      },
    );

    expect([403, 404]).toContain(guessedConversation.status());
    expect(guessedConversation.headers()["cache-control"]).toContain("no-store");
  });
});
