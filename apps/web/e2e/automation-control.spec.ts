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

type EnquiryRecord = {
  id: string;
  firstName: string;
  status: string;
};

function normaliseSecret(value: string): string {
  const secret = value.replace(/[\s-]/g, "").toUpperCase();
  if (secret.length < 16 || !/^[A-Z2-7]+=*$/.test(secret)) {
    throw new Error("E2E_CASE_USER_TOTP_SECRET is not valid Base32.");
  }
  return secret;
}

async function stableTotpCode(page: Page): Promise<string> {
  if (!totpSecret) throw new Error("E2E_CASE_USER_TOTP_SECRET is required.");
  const remaining = 30_000 - (Date.now() % 30_000);
  if (remaining < 5_000) await page.waitForTimeout(remaining + 300);
  return new OTPAuth.TOTP({
    issuer: "BusinessOS",
    label: email ?? "Automation control E2E",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(normaliseSecret(totpSecret)),
  }).generate();
}

async function signIn(page: Page): Promise<void> {
  if (!email || !password || !totpSecret) {
    throw new Error(
      "E2E_CASE_USER_EMAIL, E2E_CASE_USER_PASSWORD and E2E_CASE_USER_TOTP_SECRET must be configured.",
    );
  }
  await page.goto("/login?returnTo=%2Fdashboard");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(dashboard|mfa\/challenge)/, { timeout: 20_000 });
  if (new URL(page.url()).pathname === "/mfa/challenge") {
    await page.getByLabel("Verification code").fill(await stableTotpCode(page));
    await page.getByRole("button", { name: "Verify and continue" }).click();
  }
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
}

test.describe("automation control", () => {
  test("creates, completes and isolates the new-enquiry response workflow", async ({
    page,
  }) => {
    test.skip(
      !email || !password || !totpSecret,
      "Dedicated AAL2 automation E2E credentials have not been configured.",
    );
    test.setTimeout(90_000);
    await signIn(page);

    const meResponse = await page.request.get("/api/auth/me");
    expect(meResponse.status()).toBe(200);
    const user = (await meResponse.json()) as WorkspaceUser;
    const requiredPermissions = [
      "automation.read",
      "work_items.complete",
      "enquiries.create",
      "enquiries.read",
      "enquiries.update",
      "enquiries.delete",
    ];
    const organisation = user.organisations.find((value) => {
      if (value.organisationStatus.toUpperCase() !== "ACTIVE") return false;
      const granted = new Set(
        value.permissions.map((permission) => permission.toLowerCase()),
      );
      return requiredPermissions.every((permission) => granted.has(permission));
    });
    test.skip(
      !organisation,
      "The E2E user has no active organisation with automation-control permissions.",
    );
    if (!organisation) throw new Error("Automation E2E organisation is missing.");

    const unique = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const firstName = `Automation-${unique}`;
    let enquiry: EnquiryRecord | null = null;

    try {
      const createResponse = await page.request.post("/api/enquiries", {
        data: {
          organisationId: organisation.organisationId,
          firstName,
          lastName: "Playwright",
          email: `automation-${unique}@example.test`,
          phone: "07123456789",
          country: "United Kingdom",
          serviceType: "Immigration workflow E2E",
          source: "Playwright E2E",
          message: "Verify the deterministic new-enquiry response workflow.",
          status: "NEW",
          priority: "HIGH",
        },
      });
      const createText = await createResponse.text();
      expect(createResponse.ok(), createText).toBe(true);
      enquiry = JSON.parse(createText) as EnquiryRecord;

      await page.goto("/operations");
      await expect(
        page.getByRole("heading", { name: "Operations", exact: true }),
      ).toBeVisible({ timeout: 20_000 });

      const workItem = page.locator("article").filter({
        has: page.getByRole("heading", {
          name: "Contact new enquiry",
          exact: true,
        }),
        hasText: firstName,
      });
      await expect(workItem).toContainText("Contact new enquiry", {
        timeout: 20_000,
      });
      await expect(workItem).toContainText("High");

      page.once("dialog", (dialog) =>
        dialog.accept("Initial response recorded by Playwright E2E."),
      );
      await workItem.getByRole("button", { name: /Complete Contact new enquiry/i }).click();
      await expect(page.getByRole("status")).toContainText(
        "Completed: Contact new enquiry",
        { timeout: 20_000 },
      );
      await expect(workItem).toHaveCount(0);

      const enquiryQuery = new URLSearchParams({
        organisationId: organisation.organisationId,
      });
      const enquiryResponse = await page.request.get(
        `/api/enquiries/${enquiry.id}?${enquiryQuery.toString()}`,
      );
      expect(enquiryResponse.status()).toBe(200);
      const updatedEnquiry = (await enquiryResponse.json()) as EnquiryRecord;
      expect(updatedEnquiry.status).toBe("CONTACTED");

      const foreignQuery = new URLSearchParams({
        organisationId: crypto.randomUUID(),
      });
      const foreignResponse = await page.request.get(
        `/api/automation-control?${foreignQuery.toString()}`,
      );
      expect(foreignResponse.status()).toBe(403);
      expect(foreignResponse.headers()["cache-control"]).toContain("no-store");
    } finally {
      if (enquiry) {
        const query = new URLSearchParams({
          organisationId: organisation.organisationId,
        });
        const deleteResponse = await page.request.delete(
          `/api/enquiries/${enquiry.id}?${query.toString()}`,
        );
        expect(deleteResponse.status()).toBe(204);
      }
    }
  });
});
