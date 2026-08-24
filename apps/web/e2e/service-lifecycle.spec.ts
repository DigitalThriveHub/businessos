import { expect, test, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";
const email = process.env.E2E_CASE_USER_EMAIL,
  password = process.env.E2E_CASE_USER_PASSWORD,
  secret = process.env.E2E_CASE_USER_TOTP_SECRET;
function normalise(value: string) {
  return value.replace(/[\s-]/g, "").toUpperCase();
}
async function signIn(page: Page) {
  if (!email || !password || !secret)
    throw new Error("Gate G AAL2 credentials required.");
  await page.goto("/login?returnTo=%2Fservice-lifecycle");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(service-lifecycle|mfa\/challenge)/);
  if (page.url().includes("mfa/challenge")) {
    const code = new OTPAuth.TOTP({
      issuer: "BusinessOS",
      label: email,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(normalise(secret)),
    }).generate();
    await page.getByLabel("Verification code").fill(code);
    await page.getByRole("button", { name: "Verify and continue" }).click();
  }
}
test("Gate G exposes the tenant lifecycle queue to an authorised AAL2 user", async ({
  page,
}) => {
  test.skip(!email || !password || !secret, "Gate G credentials missing.");
  await signIn(page);
  await expect(page).toHaveURL(/\/service-lifecycle/);
  await expect(
    page.getByRole("heading", { name: "Service lifecycle" }),
  ).toBeVisible();
  await expect(page.getByText("Controlled work queue")).toBeVisible();
  const response = await page.request.get("/api/auth/me");
  expect(response.status()).toBe(200);
});
