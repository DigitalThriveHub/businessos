import { expect, test, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";

const email = process.env.E2E_CASE_USER_EMAIL;
const password = process.env.E2E_CASE_USER_PASSWORD;
const totpSecret = process.env.E2E_CASE_USER_TOTP_SECRET;
const requireLiveGateK = process.env.REQUIRE_LIVE_GATE_K === "1";
const providerConfigured = Boolean(
  process.env.OPENAI_AGENT_ENABLED === "true" &&
  process.env.OPENAI_API_KEY &&
  process.env.OPENAI_AGENT_MODEL,
);

type WorkspaceUser = {
  organisations: Array<{
    organisationId: string;
    organisationStatus: string;
    permissions: string[];
  }>;
};

type AiWorkspace = {
  availability: {
    state: "FREE_MODE" | "READY" | "CONFIGURATION_REQUIRED";
    commandAvailable: boolean;
    providerCallsEnabled: boolean;
  };
  activeConversationId: string | null;
  messages: Array<{ role: "USER" | "ASSISTANT"; content: string }>;
  actions: Array<{
    status:
      | "PROPOSED"
      | "PENDING_APPROVAL"
      | "BLOCKED"
      | "APPROVED"
      | "REJECTED"
      | "EXECUTING"
      | "EXECUTED"
      | "FAILED"
      | "EXPIRED"
      | "CANCELLED";
  }>;
};

function normaliseSecret(value: string): string {
  const valueWithoutSeparators = value.replace(/[\s-]/g, "").toUpperCase();
  if (
    valueWithoutSeparators.length < 16 ||
    !/^[A-Z2-7]+=*$/.test(valueWithoutSeparators)
  ) {
    throw new Error("E2E_CASE_USER_TOTP_SECRET is not valid Base32.");
  }
  return valueWithoutSeparators;
}

async function stableTotpCode(page: Page): Promise<string> {
  if (!totpSecret) throw new Error("E2E_CASE_USER_TOTP_SECRET is required.");
  const remaining = 30_000 - (Date.now() % 30_000);
  if (remaining < 5_000) await page.waitForTimeout(remaining + 300);
  return new OTPAuth.TOTP({
    issuer: "BusinessOS",
    label: email ?? "Gate K E2E",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(normaliseSecret(totpSecret)),
  }).generate();
}

async function signIn(page: Page): Promise<void> {
  if (!email || !password || !totpSecret) {
    throw new Error(
      "E2E_CASE_USER_EMAIL, E2E_CASE_USER_PASSWORD and E2E_CASE_USER_TOTP_SECRET are required.",
    );
  }

  await page.goto("/login?returnTo=%2Fai");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(ai|mfa\/challenge)/, { timeout: 20_000 });

  if (new URL(page.url()).pathname === "/mfa/challenge") {
    await page.getByLabel("Verification code").fill(await stableTotpCode(page));
    await page.getByRole("button", { name: "Verify and continue" }).click();
  }

  await expect(page).toHaveURL(/\/ai/, { timeout: 20_000 });
}

async function aiOrganisation(page: Page) {
  const response = await page.request.get("/api/auth/me");
  expect(response.status()).toBe(200);
  const user = (await response.json()) as WorkspaceUser;
  return user.organisations.find((entry) => {
    const permissions = new Set(
      entry.permissions.map((permission) => permission.toLowerCase()),
    );
    return (
      entry.organisationStatus.toUpperCase() === "ACTIVE" &&
      permissions.has("ai.workspace.access")
    );
  });
}

test.describe("Gate K governed personal AI", () => {
  test("loads a permission-filtered workspace and rejects another tenant", async ({
    page,
  }) => {
    test.skip(
      (!email || !password || !totpSecret) && !requireLiveGateK,
      "Dedicated AAL2 Gate K credentials are not configured.",
    );
    test.setTimeout(90_000);
    await signIn(page);

    const organisation = await aiOrganisation(page);
    if (!organisation && requireLiveGateK) {
      throw new Error(
        "The Gate K account has no active organisation with ai.workspace.access.",
      );
    }
    test.skip(!organisation, "The Gate K role is not provisioned.");
    if (!organisation) throw new Error("Gate K organisation is unavailable.");

    await expect(page.getByRole("heading", { name: "My AI" })).toBeVisible();
    await expect(
      page.getByText("Permission filtered", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/cannot send messages, change records/i),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText(
      /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/,
    );

    const ownQuery = new URLSearchParams({
      organisationId: organisation.organisationId,
    });
    const own = await page.request.get(`/api/my-ai?${ownQuery.toString()}`);
    const ownBody = await own.text();
    expect(own.status(), ownBody).toBe(200);
    expect(own.headers()["cache-control"]).toContain("no-store");
    const ownWorkspace = JSON.parse(ownBody) as AiWorkspace;
    if (ownWorkspace.availability.state === "FREE_MODE") {
      expect(ownWorkspace.availability.commandAvailable).toBe(false);
      expect(ownWorkspace.availability.providerCallsEnabled).toBe(false);
      await expect(page.getByText(/£0 AI provider usage/i)).toBeVisible();
    }

    const foreignQuery = new URLSearchParams({
      organisationId: crypto.randomUUID(),
    });
    const foreign = await page.request.get(
      `/api/my-ai?${foreignQuery.toString()}`,
    );
    expect(foreign.status()).toBe(403);
    expect(foreign.headers()["cache-control"]).toContain("no-store");
  });

  test("completes a real provider daily brief without claiming execution", async ({
    page,
  }) => {
    test.skip(
      (!email || !password || !totpSecret || !providerConfigured) &&
        !requireLiveGateK,
      "Live Gate K credentials and OpenAI configuration are not present.",
    );
    if (!providerConfigured) {
      throw new Error(
        "REQUIRE_LIVE_GATE_K=1 requires OPENAI_AGENT_ENABLED=true, OPENAI_API_KEY and OPENAI_AGENT_MODEL.",
      );
    }

    test.setTimeout(120_000);
    await signIn(page);
    const organisation = await aiOrganisation(page);
    if (!organisation) {
      throw new Error(
        "The live Gate K account needs ai.workspace.access in an active organisation.",
      );
    }

    const commandResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/my-ai/mutations") &&
        response.request().method() === "POST",
      { timeout: 70_000 },
    );
    await page.getByRole("button", { name: "Generate daily brief" }).click();
    const commandResponse = await commandResponsePromise;
    expect(commandResponse.status(), await commandResponse.text()).toBe(201);

    await expect(page.getByText("My AI", { exact: true }).last()).toBeVisible({
      timeout: 20_000,
    });
    const query = new URLSearchParams({
      organisationId: organisation.organisationId,
    });
    const workspaceResponse = await page.request.get(
      `/api/my-ai?${query.toString()}`,
    );
    expect(workspaceResponse.status(), await workspaceResponse.text()).toBe(
      200,
    );
    const workspace = (await workspaceResponse.json()) as AiWorkspace;
    expect(workspace.activeConversationId).toBeTruthy();
    expect(
      workspace.messages.some((message) => message.role === "ASSISTANT"),
    ).toBe(true);
    expect(
      workspace.actions.every((action) =>
        [
          "PROPOSED",
          "PENDING_APPROVAL",
          "BLOCKED",
          "APPROVED",
          "REJECTED",
          "EXECUTING",
          "EXECUTED",
          "FAILED",
          "EXPIRED",
          "CANCELLED",
        ].includes(action.status),
      ),
    ).toBe(true);
    await expect(page.getByText(/approval is not execution/i)).toBeVisible();
  });
});
