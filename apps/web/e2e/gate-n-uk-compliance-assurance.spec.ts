import { expect, test, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";

const email = process.env.E2E_CASE_USER_EMAIL;
const password = process.env.E2E_CASE_USER_PASSWORD;
const totpSecret = process.env.E2E_CASE_USER_TOTP_SECRET;
const requireLive = process.env.REQUIRE_LIVE_GATE_N === "1";
const liveReleaseReference = process.env.E2E_GATE_N_RELEASE_REFERENCE;

type WorkspaceUser = {
  organisations: Array<{
    organisationId: string;
    organisationStatus: string;
    permissions: string[];
  }>;
};

type Dashboard = {
  access: {
    assuranceLevel: "AAL1" | "AAL2";
    rightsManage: boolean;
    assuranceRead: boolean;
    releaseApprove: boolean;
  };
  summary: {
    mandatoryEvidencePassed: number;
    mandatoryEvidenceTotal: number;
    releaseBlockerCount: number;
    releaseEligible: boolean;
  };
  assurance: {
    releaseEligible: boolean;
    blockers: Array<{ code: string; subject: string; detail: string }>;
    evidence: Array<{
      evidenceKey: string;
      mandatory: boolean;
      effectiveStatus: string;
      recordedByUserId: string | null;
      reviewedByUserId: string | null;
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
    throw new Error("Dedicated AAL2 Gate N credentials are required.");
  }
  await page.goto("/login?returnTo=%2Fassurance");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(assurance|mfa\/challenge)/, { timeout: 20_000 });
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
  await expect(page).toHaveURL(/\/assurance/, { timeout: 20_000 });
}

async function organisation(page: Page) {
  const response = await page.request.get("/api/auth/me");
  expect(response.status()).toBe(200);
  const user = (await response.json()) as WorkspaceUser;
  return user.organisations.find((entry) => {
    const permissions = new Set(
      entry.permissions.map((permission) => permission.toLowerCase()),
    );
    return (
      entry.organisationStatus.toUpperCase() === "ACTIVE" &&
      permissions.has("compliance.read") &&
      permissions.has("compliance.manage") &&
      permissions.has("assurance.read")
    );
  });
}

async function getDashboard(page: Page, organisationId: string) {
  const response = await page.request.get(
    `/api/compliance-assurance?${new URLSearchParams({ organisationId })}`,
  );
  const text = await response.text();
  expect(response.status(), text).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  return JSON.parse(text) as Dashboard;
}

async function mutate(page: Page, input: Record<string, unknown>) {
  return page.evaluate(async (payload) => {
    const response = await fetch("/api/compliance-assurance/mutations", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    };
  }, input);
}

test.describe("Gate N UK compliance and production assurance", () => {
  test("operates a compact AAL2 rights workflow and rejects another tenant", async ({
    page,
  }) => {
    test.skip(
      (!email || !password || !totpSecret) && !requireLive,
      "Dedicated Gate N credentials are not configured.",
    );
    test.setTimeout(90_000);
    await signIn(page);
    const org = await organisation(page);
    if (!org) throw new Error("The Gate N compliance role is not provisioned.");

    await expect(
      page.getByRole("heading", { name: "Assurance centre" }),
    ).toBeVisible({ timeout: 30_000 });
    for (const area of [
      "Overview",
      "Data rights",
      "Incidents",
      "Retention",
      "Release evidence",
    ]) {
      await expect(
        page.getByRole("button", { name: area, exact: true }),
      ).toBeVisible({
        timeout: 30_000,
      });
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

    const own = await getDashboard(page, org.organisationId);
    expect(own.access.assuranceLevel).toBe("AAL2");
    expect(own.access.rightsManage).toBe(true);
    const foreign = await page.request.get(
      `/api/compliance-assurance?${new URLSearchParams({
        organisationId: crypto.randomUUID(),
      })}`,
    );
    expect(foreign.status()).toBe(403);
    expect(foreign.headers()["cache-control"]).toContain("no-store");

    const marker = `gate-n-${Date.now()}`;
    const created = await mutate(page, {
      operation: "right.create",
      organisationId: org.organisationId,
      payload: {
        requestType: "ACCESS",
        subjectName: `Acceptance ${marker}`,
        subjectEmail: `${marker}@example.invalid`,
        subjectPhone: null,
        clientId: null,
        receivedAt: null,
        requestDetails:
          "Controlled Gate N acceptance request; no real personal data is used.",
        ownerUserId: null,
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.status).toBe("RECEIVED");
    const requestId = String(created.body.id);
    const extended = await mutate(page, {
      operation: "right.extend",
      organisationId: org.organisationId,
      requestId,
      payload: {
        extendedDueAt: new Date(
          Date.now() + 45 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        reason:
          "Acceptance proves a controlled complexity extension with recorded notice evidence.",
        notificationReference: `acceptance://notice/${marker}`,
        expectedVersion: Number(created.body.version),
      },
    });
    expect(extended.status, JSON.stringify(extended.body)).toBe(200);
    expect(extended.body.notificationReferenceRecorded).toBe(true);
    const withdrawn = await mutate(page, {
      operation: "right.transition",
      organisationId: org.organisationId,
      requestId,
      payload: {
        status: "WITHDRAWN",
        identityStatus: "NOT_STARTED",
        note: "Acceptance fixture withdrawn after tenant and audit controls passed.",
        evidenceReference: `acceptance://${marker}`,
        responseReference: null,
        expectedVersion: Number(extended.body.version),
      },
    });
    expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200);
    expect(withdrawn.body.status).toBe("WITHDRAWN");
  });

  test("approves production only when current independent evidence has no blockers", async ({
    page,
  }) => {
    test.skip(!requireLive, "Live Gate N production evidence is not required.");
    if (!liveReleaseReference) {
      throw new Error(
        "REQUIRE_LIVE_GATE_N=1 requires E2E_GATE_N_RELEASE_REFERENCE.",
      );
    }
    test.setTimeout(120_000);
    await signIn(page);
    const org = await organisation(page);
    if (!org) throw new Error("The Gate N release role is not provisioned.");
    const current = await getDashboard(page, org.organisationId);
    expect(current.access.releaseApprove).toBe(true);
    expect(current.summary.mandatoryEvidenceTotal).toBeGreaterThanOrEqual(12);
    expect(current.summary.mandatoryEvidencePassed).toBe(
      current.summary.mandatoryEvidenceTotal,
    );
    expect(current.assurance.blockers).toEqual([]);
    expect(current.assurance.releaseEligible).toBe(true);
    for (const evidence of current.assurance.evidence.filter(
      (item) => item.mandatory,
    )) {
      expect(evidence.effectiveStatus).toBe("PASS");
      expect(evidence.recordedByUserId).toBeTruthy();
      expect(evidence.reviewedByUserId).toBeTruthy();
      expect(evidence.recordedByUserId).not.toBe(evidence.reviewedByUserId);
    }

    const decision = await mutate(page, {
      operation: "release.decide",
      organisationId: org.organisationId,
      payload: {
        releaseReference: liveReleaseReference,
        environment: "PRODUCTION",
        decision: "APPROVED",
        rationale:
          "All mandatory production controls have current independently reviewed evidence and no blocker remains.",
        changeReference: process.env.E2E_GATE_N_CHANGE_REFERENCE ?? null,
      },
    });
    expect(decision.status, JSON.stringify(decision.body)).toBe(200);
    expect(decision.body.decision).toBe("APPROVED");
    expect(decision.body.eligibleAtDecision).toBe(true);
  });
});
