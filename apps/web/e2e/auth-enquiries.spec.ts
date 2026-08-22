import { expect, test, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";

const email = process.env.E2E_USER_EMAIL;
const password = process.env.E2E_USER_PASSWORD;
const totpSecret =
  process.env.E2E_USER_TOTP_SECRET ??
  (email !== undefined && email === process.env.E2E_CASE_USER_EMAIL
    ? process.env.E2E_CASE_USER_TOTP_SECRET
    : undefined);

function normaliseSecret(value: string): string {
  const secret = value.replace(/[\s-]/g, "").toUpperCase();

  if (secret.length < 16 || !/^[A-Z2-7]+=*$/.test(secret)) {
    throw new Error("The E2E user TOTP secret is not valid Base32.");
  }

  return secret;
}

async function stableTotpCode(page: Page): Promise<string> {
  if (!totpSecret) {
    throw new Error(
      "E2E_USER_TOTP_SECRET is required when the E2E user has MFA enabled.",
    );
  }

  const remaining = 30_000 - (Date.now() % 30_000);

  if (remaining < 5_000) {
    await page.waitForTimeout(remaining + 300);
  }

  return new OTPAuth.TOTP({
    issuer: "BusinessOS",
    label: email ?? "BusinessOS E2E",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(normaliseSecret(totpSecret)),
  }).generate();
}

async function signIn(page: Page): Promise<void> {
  if (!email || !password) {
    throw new Error("E2E_USER_EMAIL and E2E_USER_PASSWORD must be configured.");
  }

  await page.goto("/login?returnTo=%2Fdashboard");

  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();

  await page.waitForURL(/\/(dashboard|mfa\/challenge)/, {
    timeout: 20_000,
  });

  if (new URL(page.url()).pathname === "/mfa/challenge") {
    await page.getByLabel("Verification code").fill(await stableTotpCode(page));

    await page.getByRole("button", { name: /verify and continue/i }).click();
  }

  await expect(page).toHaveURL(/\/dashboard/, {
    timeout: 20_000,
  });

  await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible();
}
test.describe("authentication security", () => {
  test("redirects an unauthenticated user away from protected routes", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    await expect(page).toHaveURL(/\/login/, {
      timeout: 15_000,
    });
  });

  test("allows login and secure logout", async ({ page }) => {
    test.skip(!email || !password, "E2E credentials have not been configured.");

    await signIn(page);

    await page.getByRole("button", { name: /sign out|log out/i }).click();

    await expect(page).toHaveURL(/\/login/, {
      timeout: 15_000,
    });

    await page.goto("/dashboard");

    await expect(page).toHaveURL(/\/login/, {
      timeout: 15_000,
    });
  });
});

test.describe("enquiries workflow", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!email || !password, "E2E credentials have not been configured.");

    await signIn(page);
  });

  test("creates, searches, edits and deletes an enquiry", async ({ page }) => {
    const uniqueId = Date.now();
    const firstName = `E2E${uniqueId}`;
    const lastName = "Playwright";
    const updatedLastName = "Verified";
    const emailAddress = `e2e-${uniqueId}@example.test`;

    await page.goto("/enquiries");

    await expect(
      page.getByRole("heading", {
        name: "Enquiries",
        exact: true,
      }),
    ).toBeVisible({ timeout: 15_000 });

    const addEnquiryButton = page.getByRole("button", {
      name: "Add enquiry",
    });

    await expect(addEnquiryButton).toBeEnabled({
      timeout: 15_000,
    });

    await addEnquiryButton.click();

    const createDialog = page.getByRole("dialog", {
      name: "Add enquiry",
    });

    await expect(createDialog).toBeVisible();

    await createDialog.getByLabel("First name").fill(firstName);
    await createDialog.getByLabel("Last name").fill(lastName);
    await createDialog.getByLabel("Email").fill(emailAddress);
    await createDialog.getByLabel("Phone").fill("07123456789");
    await createDialog.getByLabel("Country").fill("United Kingdom");
    await createDialog
      .getByLabel("Service type")
      .fill("E2E immigration enquiry");
    await createDialog.getByLabel("Source").fill("Playwright E2E");
    await createDialog.getByLabel("Status").selectOption("NEW");
    await createDialog.getByLabel("Priority").selectOption("HIGH");
    await createDialog
      .getByLabel("Message or notes")
      .fill("Automated browser test enquiry.");

    await createDialog.getByRole("button", { name: "Create enquiry" }).click();

    await expect(
      page.getByRole("status").filter({
        hasText: "Enquiry created successfully.",
      }),
    ).toBeVisible();

    const search = page.getByPlaceholder(
      "Search name, email, phone or service",
    );

    await search.fill(emailAddress);

    const createdRow = page.locator("tbody tr").filter({
      hasText: emailAddress,
    });

    await expect(createdRow).toBeVisible({
      timeout: 15_000,
    });

    await expect(createdRow).toContainText(firstName);
    await expect(createdRow).toContainText("High");

    await createdRow.getByRole("button", { name: "Edit" }).click();

    const editDialog = page.getByRole("dialog", {
      name: "Edit enquiry",
    });

    await expect(editDialog).toBeVisible();

    await editDialog.getByLabel("Last name").fill(updatedLastName);

    await editDialog.getByLabel("Status").selectOption("CONTACTED");

    await editDialog.getByLabel("Priority").selectOption("URGENT");

    await editDialog.getByRole("button", { name: "Save changes" }).click();

    await expect(
      page.getByRole("status").filter({
        hasText: "Enquiry updated successfully.",
      }),
    ).toBeVisible();

    const updatedRow = page.locator("tbody tr").filter({
      hasText: emailAddress,
    });

    await expect(updatedRow).toContainText(updatedLastName);
    await expect(updatedRow).toContainText("Contacted");
    await expect(updatedRow).toContainText("Urgent");

    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("confirm");
      expect(dialog.message()).toContain(firstName);
      await dialog.accept();
    });

    await updatedRow.getByRole("button", { name: "Delete" }).click();

    await expect(
      page.getByRole("status").filter({
        hasText: "Enquiry deleted successfully.",
      }),
    ).toBeVisible();

    await expect(
      page.locator("tbody tr").filter({
        hasText: emailAddress,
      }),
    ).toHaveCount(0);
  });
});

test.describe("tenant isolation", () => {
  test("denies access to another organisation's enquiries", async ({
    page,
  }) => {
    test.skip(!email || !password, "E2E credentials have not been configured.");

    await signIn(page);

    const foreignOrganisationId = crypto.randomUUID();

    const query = new URLSearchParams({
      organisationId: foreignOrganisationId,
      page: "1",
      limit: "20",
    });

    const response = await page.request.get(
      `/api/enquiries?${query.toString()}`,
    );

    expect(response.status()).toBe(403);
    expect(response.headers()["cache-control"]).toContain("no-store");

    const responseBody = (await response.json()) as Record<string, unknown>;

    expect(responseBody).toEqual({
      message: "You do not have permission to perform this action.",
    });

    expect(responseBody).not.toHaveProperty("items");
    expect(responseBody).not.toHaveProperty("pagination");
  });
});
