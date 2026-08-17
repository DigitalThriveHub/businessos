import {
  expect,
  test,
  type Page,
} from "@playwright/test";

const email = process.env.E2E_USER_EMAIL;
const password = process.env.E2E_USER_PASSWORD;

async function signIn(page: Page) {
  if (!email || !password) {
    throw new Error(
      "E2E_USER_EMAIL and E2E_USER_PASSWORD must be configured.",
    );
  }

  await page.goto(
    "/login?returnTo=%2Fsettings%2Fprofile",
  );

  await page.getByLabel(/email/i).fill(email);
  await page
    .getByLabel(/password/i)
    .fill(password);

  await page
    .getByRole("button", {
      name: /sign in/i,
    })
    .click();

  await expect(page).toHaveURL(
    /\/settings\/profile/,
    {
      timeout: 20_000,
    },
  );

  await expect(
    page.getByRole("heading", {
      name: "Your profile",
    }),
  ).toBeVisible();
}

async function saveProfile(page: Page) {
  const responsePromise =
    page.waitForResponse(
      (response) =>
        response
          .url()
          .endsWith("/api/auth/me") &&
        response.request().method() === "PATCH",
    );

  await page
    .getByRole("button", {
      name: "Save changes",
    })
    .click();

 const response = await responsePromise;
const responseBody = await response.text();

expect(
  response.status(),
  responseBody,
).toBe(200);

  await expect(
    page.getByRole("status").filter({
      hasText: "Profile updated successfully.",
    }),
  ).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("account profile", () => {
  test("updates and persists personal profile details", async ({
    page,
  }) => {
    test.skip(
      !email || !password,
      "E2E credentials have not been configured.",
    );

    await signIn(page);

    const displayNameInput =
      page.getByLabel("Display name");

    const firstNameInput =
      page.getByLabel("First name");

    const lastNameInput =
      page.getByLabel("Last name");

    const original = {
      displayName:
        await displayNameInput.inputValue(),
      firstName:
        await firstNameInput.inputValue(),
      lastName:
        await lastNameInput.inputValue(),
    };

    const uniqueId = Date.now()
      .toString()
      .slice(-8);

    const updated = {
      displayName: `E2E Profile ${uniqueId}`,
      firstName: `E2E${uniqueId}`,
      lastName: "Verified",
    };

    try {
      await displayNameInput.fill(
        updated.displayName,
      );

      await firstNameInput.fill(
        updated.firstName,
      );

      await lastNameInput.fill(
        updated.lastName,
      );

      await saveProfile(page);

      await expect(
        page
          .locator("header")
          .getByText(
            updated.displayName,
            {
              exact: true,
            },
          ),
      ).toBeVisible({
        timeout: 15_000,
      });

      await page.reload();

      await expect(
        page.getByLabel("Display name"),
      ).toHaveValue(updated.displayName);

      await expect(
        page.getByLabel("First name"),
      ).toHaveValue(updated.firstName);

      await expect(
        page.getByLabel("Last name"),
      ).toHaveValue(updated.lastName);
    } finally {
      await page.goto("/settings/profile");

      await page
        .getByLabel("Display name")
        .fill(original.displayName);

      await page
        .getByLabel("First name")
        .fill(original.firstName);

      await page
        .getByLabel("Last name")
        .fill(original.lastName);

      const saveButton = page.getByRole(
        "button",
        {
          name: "Save changes",
        },
      );

      if (await saveButton.isEnabled()) {
        await saveProfile(page);
      }
    }
  });
});