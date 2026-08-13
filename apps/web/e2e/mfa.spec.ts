import {
  expect,
  test,
  type Page,
} from "@playwright/test";
import * as OTPAuth from "otpauth";

const email = process.env.E2E_MFA_USER_EMAIL;
const password =
  process.env.E2E_MFA_USER_PASSWORD;

const factorName = "Playwright MFA authenticator";
const securityPath = "/settings/security";

function normaliseSecret(value: string): string {
  const secret = value
    .replace(/[\s-]/g, "")
    .toUpperCase();

  if (
    secret.length < 16 ||
    !/^[A-Z2-7]+=*$/.test(secret)
  ) {
    throw new Error(
      "Supabase returned an invalid TOTP secret.",
    );
  }

  return secret;
}

function generateTotpCode(secret: string): string {
  const totp = new OTPAuth.TOTP({
    issuer: "BusinessOS",
    label: email ?? "MFA test account",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });

  return totp.generate();
}

async function generateStableCode(
  page: Page,
  secret: string,
): Promise<string> {
  const periodMilliseconds = 30_000;
  const elapsed =
    Date.now() % periodMilliseconds;
  const remaining =
    periodMilliseconds - elapsed;

  /*
   * Avoid using a code during the last five seconds
   * of its validity period.
   */
  if (remaining < 5_000) {
    await page.waitForTimeout(remaining + 300);
  }

  return generateTotpCode(secret);
}

async function signIn(page: Page): Promise<void> {
  if (!email || !password) {
    throw new Error(
      "E2E_MFA_USER_EMAIL and E2E_MFA_USER_PASSWORD must be configured.",
    );
  }

  await page.goto(
    `/login?returnTo=${encodeURIComponent(securityPath)}`,
  );

  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);

  await page
    .getByRole("button", {
      name: /sign in securely/i,
    })
    .click();
}

test.describe("multi-factor authentication", () => {
  test("enrols, challenges, verifies and removes an authenticator", async ({
    page,
  }) => {
    test.skip(
      !email || !password,
      "Dedicated MFA test credentials are not configured.",
    );

    test.setTimeout(60_000);

    /*
     * Step 1: sign in with a clean MFA test account.
     */
    await signIn(page);

    await expect(page).toHaveURL(
      /\/settings\/security/,
      {
        timeout: 20_000,
      },
    );

    await expect(
      page.getByRole("heading", {
        name: "Security settings",
      }),
    ).toBeVisible();

    await expect(
      page.getByText(
        "No verified authenticator currently protects this account.",
        {
          exact: true,
        },
      ),
    ).toBeVisible();

    /*
     * Step 2: enrol MFA and read the temporary secret
     * from the page into test memory only.
     */
    await page
      .getByLabel("Authenticator name")
      .fill(factorName);

    await page
      .getByRole("button", {
        name: "Begin setup",
      })
      .click();

    await expect(
      page.getByRole("heading", {
        name: "Scan the QR code",
      }),
    ).toBeVisible();

    const displayedSecret =
      await page.locator("code").first().innerText();

    const totpSecret =
      normaliseSecret(displayedSecret);

    const enrollmentCode =
      await generateStableCode(
        page,
        totpSecret,
      );

    await page
      .getByLabel("Six-digit verification code")
      .fill(enrollmentCode);

    await page
      .getByRole("button", {
        name: "Enable authenticator",
      })
      .click();

    await expect(
      page.getByRole("status").filter({
        hasText:
          "Authenticator enabled successfully.",
      }),
    ).toBeVisible({
      timeout: 15_000,
    });

    await expect(
      page.getByText("AAL2 verified session", {
        exact: true,
      }),
    ).toBeVisible();

    /*
     * Step 3: sign out and prove the next login
     * requires the MFA challenge.
     */
    await page
      .getByRole("button", {
        name: "Sign out",
        exact: true,
      })
      .click();

    await expect(page).toHaveURL(/\/login/, {
      timeout: 15_000,
    });

    await signIn(page);

    await expect(page).toHaveURL(
      /\/mfa\/challenge/,
      {
        timeout: 20_000,
      },
    );

    await expect(
      page.getByRole("heading", {
        name: "Verify your identity",
      }),
    ).toBeVisible();

    const challengeCode =
      await generateStableCode(
        page,
        totpSecret,
      );

    await page
      .getByLabel("Verification code")
      .fill(challengeCode);

    await page
      .getByRole("button", {
        name: "Verify and continue",
      })
      .click();

    await expect(page).toHaveURL(
      /\/settings\/security/,
      {
        timeout: 20_000,
      },
    );

    await expect(
      page.getByText("AAL2 verified session", {
        exact: true,
      }),
    ).toBeVisible({
      timeout: 15_000,
    });

    /*
     * Step 4: remove the test factor so the account
     * is clean and the test can run again.
     */
    const factorCard = page
      .locator("article")
      .filter({
        hasText: factorName,
      });

    await expect(factorCard).toBeVisible();

    await factorCard
      .getByRole("button", {
        name: "Remove",
      })
      .click();

    await factorCard
      .getByRole("button", {
        name: "Confirm",
      })
      .click();

    await expect(
      page.getByRole("status").filter({
        hasText:
          "Authenticator removed successfully.",
      }),
    ).toBeVisible({
      timeout: 15_000,
    });

    await expect(factorCard).toHaveCount(0);

    await page
      .getByRole("button", {
        name: "Sign out",
        exact: true,
      })
      .click();

    await expect(page).toHaveURL(/\/login/, {
      timeout: 15_000,
    });
  });
});