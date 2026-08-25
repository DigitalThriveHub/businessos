import { expect, test, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";

const email = process.env.E2E_CASE_USER_EMAIL;
const password = process.env.E2E_CASE_USER_PASSWORD;
const totpSecret = process.env.E2E_CASE_USER_TOTP_SECRET;
const requireLive = process.env.REQUIRE_LIVE_GATE_M === "1";
const liveDocumentTitle = process.env.E2E_GATE_M_DOCUMENT_TITLE;

type WorkspaceUser = {
  organisations: Array<{
    organisationId: string;
    organisationStatus: string;
    permissions: string[];
  }>;
};

type Dashboard = {
  provider: {
    state: "FREE_MODE" | "READY";
    generationEnabled: boolean;
    model: string | null;
  };
  documents: {
    items: Array<{
      analysisId: string;
      documentTitle: string;
      status: string;
      provider: string | null;
      model: string | null;
      completedAt: string | null;
      summary: string | null;
      canReview: boolean;
    }>;
  };
};

function normaliseSecret(value: string): string {
  const normalised = value.replace(/[\s-]/g, "").toUpperCase();
  if (normalised.length < 16 || !/^[A-Z2-7]+=*$/.test(normalised)) {
    throw new Error("E2E_CASE_USER_TOTP_SECRET is not valid Base32.");
  }
  return normalised;
}

async function signIn(page: Page): Promise<void> {
  if (!email || !password || !totpSecret) {
    throw new Error("Dedicated AAL2 Gate M credentials are required.");
  }
  await page.goto("/login?returnTo=%2Fmy-work");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(my-work|mfa\/challenge)/, { timeout: 20_000 });
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
  await expect(page).toHaveURL(/\/my-work/, { timeout: 20_000 });
}

async function gateMOrganisation(page: Page) {
  const response = await page.request.get("/api/auth/me");
  expect(response.status()).toBe(200);
  const user = (await response.json()) as WorkspaceUser;
  return user.organisations.find((entry) => {
    const permissions = new Set(
      entry.permissions.map((permission) => permission.toLowerCase()),
    );
    return (
      entry.organisationStatus.toUpperCase() === "ACTIVE" &&
      permissions.has("my_work.read") &&
      permissions.has("document_intelligence.read") &&
      permissions.has("control_tower.read")
    );
  });
}

async function dashboard(page: Page, organisationId: string) {
  const query = new URLSearchParams({ organisationId });
  const response = await page.request.get(
    `/api/operational-intelligence?${query.toString()}`,
  );
  const body = await response.text();
  expect(response.status(), body).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  return JSON.parse(body) as Dashboard;
}

test.describe("Gate M operational intelligence", () => {
  test("loads the compact role-aware workspaces and rejects another tenant", async ({
    page,
  }) => {
    test.skip(
      (!email || !password || !totpSecret) && !requireLive,
      "Dedicated Gate M credentials are not configured.",
    );
    test.setTimeout(90_000);
    await signIn(page);
    const organisation = await gateMOrganisation(page);
    test.skip(!organisation, "The Gate M test role is not provisioned.");
    if (!organisation) throw new Error("Gate M organisation is unavailable.");

    await expect(page.getByRole("heading", { name: "My Work" })).toBeVisible({
      timeout: 30_000,
    });
    for (const link of ["My Work", "Documents", "Control Tower"]) {
      await expect(
        page.getByRole("link", { name: link }).first(),
      ).toBeVisible();
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

    const own = await dashboard(page, organisation.organisationId);
    expect(["FREE_MODE", "READY"]).toContain(own.provider.state);

    const foreign = await page.request.get(
      `/api/operational-intelligence?${new URLSearchParams({
        organisationId: crypto.randomUUID(),
      }).toString()}`,
    );
    expect(foreign.status()).toBe(403);
    expect(foreign.headers()["cache-control"]).toContain("no-store");

    await page.goto("/documents");
    await expect(
      page.getByRole("heading", { name: "Document review" }),
    ).toBeVisible({ timeout: 30_000 });
    await page.goto("/control-tower");
    await expect(
      page.getByRole("heading", { name: "Control Tower" }),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("observes a real provider result without bypassing human review", async ({
    page,
  }) => {
    test.skip(!requireLive, "Live Gate M provider acceptance is not required.");
    if (!liveDocumentTitle) {
      throw new Error(
        "REQUIRE_LIVE_GATE_M=1 requires E2E_GATE_M_DOCUMENT_TITLE for a dedicated clean test document.",
      );
    }
    test.setTimeout(180_000);
    await signIn(page);
    const organisation = await gateMOrganisation(page);
    if (!organisation) {
      throw new Error(
        "The Gate M account needs the document-intelligence role.",
      );
    }

    let item: Dashboard["documents"]["items"][number] | undefined;
    await expect
      .poll(
        async () => {
          const current = await dashboard(page, organisation.organisationId);
          if (!current.provider.generationEnabled) return "provider-disabled";
          item = current.documents.items.find(
            (candidate) => candidate.documentTitle === liveDocumentTitle,
          );
          return item?.status ?? "not-found";
        },
        { timeout: 150_000, intervals: [2_000, 5_000, 10_000] },
      )
      .toBe("READY");

    expect(item?.provider?.toLowerCase()).toBe("openai");
    expect(item?.model).toBeTruthy();
    expect(item?.completedAt).toBeTruthy();
    expect(item?.summary).toBeTruthy();
    expect(item?.canReview).toBe(true);

    await page.goto("/documents");
    await page
      .locator("button")
      .filter({ hasText: item?.documentTitle ?? "" })
      .first()
      .click();
    await expect(page.getByText("AAL2 human decision")).toBeVisible();
    await expect(page.getByText("Advisory summary")).toBeVisible();
  });
});
