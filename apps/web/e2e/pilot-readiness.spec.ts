import { expect, test, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";

const email = process.env.E2E_CASE_USER_EMAIL;
const password = process.env.E2E_CASE_USER_PASSWORD;
const totpSecret = process.env.E2E_CASE_USER_TOTP_SECRET;
function secret(value: string) {
  return value.replace(/[\s-]/g, "").toUpperCase();
}
async function signIn(page: Page) {
  if (!email || !password || !totpSecret)
    throw new Error("Gate J AAL2 credentials are required.");
  await page.goto("/login?returnTo=%2Fpilot-readiness");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(pilot-readiness|mfa\/challenge)/, {
    timeout: 20_000,
  });
  if (page.url().includes("mfa/challenge")) {
    const remaining = 30_000 - (Date.now() % 30_000);
    if (remaining < 5_000) await page.waitForTimeout(remaining + 300);
    const code = new OTPAuth.TOTP({
      issuer: "BusinessOS",
      label: email,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret(totpSecret)),
    }).generate();
    await page.getByLabel("Verification code").fill(code);
    await page.getByRole("button", { name: "Verify and continue" }).click();
  }
  await expect(page).toHaveURL(/\/pilot-readiness/);
}

test("Gate J controls local pilot evidence, stakeholder acceptance, defects and tenant access", async ({
  page,
}) => {
  test.skip(
    !email || !password || !totpSecret,
    "Dedicated AAL2 Gate J credentials are not configured.",
  );
  test.setTimeout(120_000);
  await signIn(page);
  await expect(
    page.getByRole("heading", { name: "Local pilot readiness" }),
  ).toBeVisible();
  const me = await page.request.get("/api/auth/me");
  expect(me.status()).toBe(200);
  const user = (await me.json()) as {
    organisations: Array<{ organisationId: string; permissions: string[] }>;
  };
  const organisation = user.organisations.find((entry) => {
    const permissions = new Set(
      entry.permissions.map((value) => value.toLowerCase()),
    );
    return (
      permissions.has("command_centre.read") &&
      permissions.has("organisation.update")
    );
  });
  test.skip(
    !organisation,
    "Gate J needs command-centre and organisation authority.",
  );
  if (!organisation) throw new Error("Gate J organisation is unavailable.");
  const origin = new URL(page.url()).origin;
  const headers = { Origin: origin, "Content-Type": "application/json" };
  const acceptance = await page.request.post("/api/pilot-readiness/mutations", {
    headers,
    data: {
      operation: "acceptance.record",
      organisationId: organisation.organisationId,
      payload: {
        key: "role.client",
        roleName: "Client",
        scenarioName: "Complete secure client onboarding and service journey",
        status: "PASS",
        evidenceNote:
          "Gate J verified the controlled client journey using realistic local pilot data.",
      },
    },
  });
  expect(acceptance.ok(), await acceptance.text()).toBe(true);
  const feedback = await page.request.post("/api/pilot-readiness/mutations", {
    headers,
    data: {
      operation: "feedback.create",
      organisationId: organisation.organisationId,
      payload: {
        affectedRole: "Client",
        severity: "LOW",
        title: "Gate J acceptance evidence",
        detail:
          "Controlled low-severity pilot observation created to prove the defect register.",
        reproductionSteps:
          "Open pilot readiness, record a low-severity observation, then refresh the dashboard.",
      },
    },
  });
  expect(feedback.ok(), await feedback.text()).toBe(true);
  const afterFeedback = await page.request.get(
    `/api/pilot-readiness?${new URLSearchParams({ organisationId: organisation.organisationId })}`,
  );
  expect(afterFeedback.status()).toBe(200);
  const feedbackDashboard = (await afterFeedback.json()) as {
    feedback: Array<{ id: string; title: string; version: number }>;
  };
  const createdFeedback = feedbackDashboard.feedback.find(
    (item) => item.title === "Gate J acceptance evidence",
  );
  expect(createdFeedback).toBeTruthy();
  if (!createdFeedback)
    throw new Error("Gate J pilot feedback was not persisted.");
  const resolved = await page.request.post("/api/pilot-readiness/mutations", {
    headers,
    data: {
      operation: "feedback.resolve",
      organisationId: organisation.organisationId,
      feedbackId: createdFeedback.id,
      payload: {
        status: "RESOLVED",
        resolution:
          "Verified the defect workflow and closed this controlled pilot observation.",
        expectedVersion: createdFeedback.version,
      },
    },
  });
  expect(resolved.ok(), await resolved.text()).toBe(true);
  const dashboard = await page.request.get(
    `/api/pilot-readiness?${new URLSearchParams({ organisationId: organisation.organisationId })}`,
  );
  expect(dashboard.status()).toBe(200);
  expect(dashboard.headers()["cache-control"]).toContain("no-store");
  expect(await dashboard.json()).toMatchObject({
    summary: { roleAcceptancesRequired: 8 },
    requiredRoles: expect.arrayContaining([
      "Client",
      "Sales",
      "Solicitor",
      "Director",
    ]),
  });
  const foreign = await page.request.get(
    `/api/pilot-readiness?${new URLSearchParams({ organisationId: crypto.randomUUID() })}`,
  );
  expect(foreign.status()).toBe(403);
});
