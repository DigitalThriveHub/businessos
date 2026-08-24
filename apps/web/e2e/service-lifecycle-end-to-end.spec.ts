import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";

const email = process.env.E2E_CASE_USER_EMAIL;
const password = process.env.E2E_CASE_USER_PASSWORD;
const totpSecret = process.env.E2E_CASE_USER_TOTP_SECRET;
const apiBaseUrl = (
  process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:4000"
).replace(/\/$/, "");

type WorkspaceUser = {
  id: string;
  organisations: Array<{
    organisationId: string;
    organisationStatus: string;
    permissions: string[];
  }>;
};
type Versioned = { id: string; version: number; status?: string };
type CaseOptions = { members: Array<{ id: string; label: string }> };
type FinanceSettings = {
  version: number;
  legalName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string;
  vatRegistrationNumber: string | null;
  invoicePrefix: string;
  creditNotePrefix: string;
  paymentPrefix: string;
  paymentTermsDays: number;
  paymentInstructions: string | null;
};

function normaliseSecret(value: string) {
  return value.replace(/[\s-]/g, "").toUpperCase();
}
async function signIn(page: Page) {
  if (!email || !password || !totpSecret)
    throw new Error("Gate G AAL2 credentials are required.");
  await page.goto("/login?returnTo=%2Fservice-lifecycle");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(service-lifecycle|mfa\/challenge)/, {
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
      secret: OTPAuth.Secret.fromBase32(normaliseSecret(totpSecret)),
    }).generate();
    await page.getByLabel("Verification code").fill(code);
    await page.getByRole("button", { name: "Verify and continue" }).click();
  }
  await expect(page).toHaveURL(/\/service-lifecycle/);
}
async function post<T>(page: Page, route: string, body: unknown): Promise<T> {
  const response = await page.request.post(route, {
    headers: {
      Origin: new URL(page.url()).origin,
      "Content-Type": "application/json",
    },
    data: body,
  });
  const text = await response.text();
  expect(response.ok(), text).toBe(true);
  return JSON.parse(text) as T;
}

test("Gate G completes the controlled client-to-income journey and blocks unsafe progression", async ({
  page,
}) => {
  test.skip(
    !email || !password || !totpSecret,
    "Dedicated AAL2 Gate G credentials are not configured.",
  );
  test.setTimeout(180_000);
  await signIn(page);

  const meResponse = await page.request.get("/api/auth/me");
  expect(meResponse.status()).toBe(200);
  const user = (await meResponse.json()) as WorkspaceUser;
  const required = new Set([
    "clients.create",
    "clients.archive",
    "matters.create",
    "matters.update",
    "matters.status.manage",
    "matters.compliance.manage",
    "engagements.read",
    "engagements.manage",
    "finance.read",
    "finance.settings.manage",
    "invoices.create",
    "invoices.issue",
    "payments.record",
    "approvals.request",
    "approvals.decide",
    "integrations.manage",
    "enquiries.update",
    "enquiries.convert",
  ]);
  const organisation = user.organisations.find((entry) => {
    const permissions = new Set(
      entry.permissions.map((key) => key.toLowerCase()),
    );
    return (
      entry.organisationStatus.toUpperCase() === "ACTIVE" &&
      [...required].every((key) => permissions.has(key))
    );
  });
  test.skip(!organisation, "The Gate G E2E role is incomplete.");
  if (!organisation) throw new Error("Gate G organisation is missing.");
  const organisationId = organisation.organisationId;
  const unique = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

  const financeResponse = await page.request.get(
    `/api/finance?${new URLSearchParams({ organisationId })}`,
  );
  const financeText = await financeResponse.text();
  expect(financeResponse.ok(), financeText).toBe(true);
  const finance = JSON.parse(financeText) as { settings: FinanceSettings };

  await post(page, "/api/finance/mutations", {
    operation: "settings.update",
    organisationId,
    payload: {
      expectedVersion: finance.settings.version,
      legalName: finance.settings.legalName ?? "Digital Thrive Hub Test Ltd",
      addressLine1: finance.settings.addressLine1 ?? "1 Test Street",
      addressLine2: finance.settings.addressLine2,
      city: finance.settings.city ?? "Birmingham",
      region: finance.settings.region,
      postalCode: finance.settings.postalCode ?? "B1 1AA",
      countryCode: "GB",
      vatScheme: "NOT_REGISTERED",
      vatRegistrationNumber: null,
      baseCurrency: "GBP",
      invoicePrefix: finance.settings.invoicePrefix || "INV",
      creditNotePrefix: finance.settings.creditNotePrefix || "CRN",
      paymentPrefix: finance.settings.paymentPrefix || "PAY",
      paymentTermsDays: finance.settings.paymentTermsDays,
      paymentInstructions:
        finance.settings.paymentInstructions ?? "Automated Gate G test evidence.",
    },
  });

  const optionsResponse = await page.request.get(
    `/api/case-management?${new URLSearchParams({ organisationId, resource: "options" })}`,
  );
  const optionsText = await optionsResponse.text();
  expect(optionsResponse.ok(), optionsText).toBe(true);
  const options = JSON.parse(optionsText) as CaseOptions;
  const caseworker = options.members[0];
  const supervisor = options.members.find(
    (member) => member.id !== caseworker?.id,
  );
  expect(caseworker, "An active caseworker is required.").toBeTruthy();
  expect(
    supervisor,
    "A distinct supervising solicitor is required.",
  ).toBeTruthy();
  if (!caseworker || !supervisor) {
    throw new Error("Gate G requires two distinct active staff members.");
  }

  const connection = await post<{
    id: string;
    signingSecret: string;
  }>(page, "/api/integrations/mutations", {
    operation: "connection.create",
    organisationId,
    payload: {
      provider: "GENERIC",
      displayName: `Gate G website intake ${unique}`,
    },
  });

  const eventId = `gate-g/intake/${unique}`;
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const intakePayload = JSON.stringify({
    firstName: `GateG-${unique}`,
    lastName: "Lifecycle",
    email: `gate-g-${unique}@example.test`,
    country: "United Kingdom",
    serviceType: "UK immigration service",
    message: "Client submitted a real website assessment form.",
    priority: "HIGH",
    lawfulBasis: "LEGITIMATE_INTEREST",
    privacyNoticeAcknowledged: true,
    privacyNoticeVersion: "2026-08",
    marketingConsent: false,
  });
  const signature = createHmac("sha256", connection.signingSecret)
    .update(timestamp)
    .update(".")
    .update(eventId)
    .update(".")
    .update(intakePayload)
    .digest("hex");
  const intake = await fetch(
    `${apiBaseUrl}/api/v1/webhooks/intake/${connection.id}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-businessos-event-id": eventId,
        "x-businessos-event-type": "enquiry.created",
        "x-businessos-timestamp": timestamp,
        "x-businessos-signature": `v1=${signature}`,
      },
      body: intakePayload,
    },
  );
  const intakeText = await intake.text();
  expect(intake.ok, intakeText).toBe(true);
  const enquiryId = (JSON.parse(intakeText) as { enquiryId: string }).enquiryId;

  for (const status of ["CONTACTED", "QUALIFIED"] as const) {
    const response = await page.request.patch(
      `/api/enquiries/${enquiryId}?${new URLSearchParams({ organisationId })}`,
      {
        headers: { Origin: new URL(page.url()).origin },
        data: {
          status,
          assignedToUserId: caseworker.id,
          lastContactedAt: new Date().toISOString(),
        },
      },
    );
    expect(response.ok(), await response.text()).toBe(true);
  }

  const conversion = await post<{ clientId: string; matterId: string }>(
    page,
    "/api/case-management/mutations",
    {
      operation: "enquiry.convert",
      organisationId,
      enquiryId,
      payload: {
        idempotencyKey: crypto.randomUUID(),
        processingLawfulBasis: "CONTRACT",
        privacyNoticeVersion: "2026-08",
        privacyNoticeAcknowledgedAt: new Date().toISOString(),
        clientAssignedToUserId: caseworker.id,
        matterTitle: `Gate G controlled journey ${unique}`,
        serviceType: "UK immigration service",
        priority: "HIGH",
        jurisdictionCountryCode: "GB",
        assignedToUserId: caseworker.id,
        supervisorUserId: supervisor.id,
        nextActionSummary: "Complete compliance and collect initial payment",
        nextActionAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    },
  );
  const matterResponse = await page.request.get(
    `/api/case-management?${new URLSearchParams({ organisationId, resource: "matter", id: conversion.matterId })}`,
  );
  const matterText = await matterResponse.text();
  expect(matterResponse.ok(), matterText).toBe(true);
  let matter = JSON.parse(matterText) as Versioned;
  const client = { id: conversion.clientId };

  // Conversion preserves the website enquiry and creates the assigned client and matter.
  expect(matter.id).toBe(conversion.matterId);

  await post(page, "/api/case-management/mutations", {
    operation: "matter.compliance",
    organisationId,
    matterId: matter.id,
    payload: {
      conflictStatus: "CLEARED",
      conflictReference: `CONFLICT-${unique}`,
      amlStatus: "VERIFIED",
      amlReference: `AML-${unique}`,
      clientCareStatus: "ACCEPTED",
      riskRating: "LOW",
      riskReason: "Identity and source-of-funds evidence reviewed.",
      expectedVersion: 1,
    },
  });

  const engagement = await post<{ id: string }>(
    page,
    "/api/service-lifecycle/mutations",
    {
      operation: "engagement.create",
      organisationId,
      payload: {
        matterId: matter.id,
        professionalFeeMinor: 10_000,
        governmentFeeMinor: 150_000,
        initialPaymentMinor: 3_000,
        submissionClearanceMinor: 8_000,
        termsVersion: "2026-08-production",
        instalments: [
          {
            sequence: 1,
            amountMinor: 3_000,
            dueAt: new Date(Date.now() + 86_400_000).toISOString(),
            description: "Deposit before legal work",
          },
          {
            sequence: 2,
            amountMinor: 5_000,
            dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
            description: "Clearance before submission",
          },
          {
            sequence: 3,
            amountMinor: 2_000,
            dueAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
            description: "Balance before completion",
          },
        ],
      },
    },
  );
  await post(page, "/api/service-lifecycle/mutations", {
    operation: "engagement.accept",
    organisationId,
    engagementId: engagement.id,
  });

  for (const toStatus of ["CONFLICT_CHECK", "CLIENT_CARE"] as const) {
    matter = await post<Versioned>(page, "/api/case-management/mutations", {
      operation: "matter.status",
      organisationId,
      matterId: matter.id,
      payload: {
        toStatus,
        reason: `Gate G progression to ${toStatus}`,
        expectedVersion: matter.version,
      },
    });
  }

  const blockedBeforeDeposit = await page.request.post(
    "/api/case-management/mutations",
    {
      headers: { Origin: new URL(page.url()).origin },
      data: {
        operation: "matter.status",
        organisationId,
        matterId: matter.id,
        payload: {
          toStatus: "ACTIVE",
          reason: "Must fail before deposit",
          expectedVersion: matter.version,
        },
      },
    },
  );
  expect(blockedBeforeDeposit.status()).toBe(409);

  const invoice = await post<Versioned & { totalMinor: string }>(
    page,
    "/api/finance/mutations",
    {
      operation: "document.create",
      organisationId,
      payload: {
        clientId: client.id,
        matterId: matter.id,
        documentType: "INVOICE",
        currencyCode: "GBP",
        reference: `Professional fee ${unique}`,
        clientVisible: true,
        lines: [
          {
            description: "Professional immigration service",
            quantityMilli: 1000,
            unitAmountMinor: 10_000,
            taxCategory: "OUTSIDE_SCOPE",
            vatRateBasisPoints: 0,
          },
        ],
      },
    },
  );
  const issued = await post<Versioned>(page, "/api/finance/mutations", {
    operation: "document.issue",
    organisationId,
    documentId: invoice.id,
    payload: { expectedVersion: invoice.version },
  });

  const recordPayment = (amountMinor: number, key: string) =>
    post(page, "/api/finance/mutations", {
      operation: "payment.record",
      organisationId,
      payload: {
        clientId: client.id,
        paymentType: "RECEIPT",
        method: "BANK_TRANSFER",
        currencyCode: "GBP",
        amountMinor,
        occurredAt: new Date().toISOString(),
        reference: `Gate G ${key}`,
        provider: "BUSINESSOS_E2E_LEDGER",
        providerReference: `test_gate_g_${unique}_${key}`,
        idempotencyKey: `gate-g/${unique}/${key}`,
        allocations: [{ documentId: invoice.id, amountMinor }],
      },
    });

  await recordPayment(3_000, "deposit");
  matter = await post<Versioned>(page, "/api/case-management/mutations", {
    operation: "matter.status",
    organisationId,
    matterId: matter.id,
    payload: {
      toStatus: "ACTIVE",
      reason: "Deposit, engagement and compliance cleared",
      expectedVersion: matter.version,
    },
  });

  await recordPayment(5_000, "submission");
  const exception = await post<{ id: string }>(
    page,
    "/api/service-lifecycle/mutations",
    {
      operation: "exception.create",
      organisationId,
      payload: {
        matterId: matter.id,
        category: "MISSING_EVIDENCE",
        severity: "HIGH",
        title: "Submission evidence requires resolution",
        detail:
          "A material evidence concern must be resolved before submission.",
        ownerUserId: caseworker.id,
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    },
  );
  const approval = await post<Versioned>(
    page,
    "/api/automation-control/mutations",
    {
      operation: "approval.create",
      organisationId,
      payload: {
        subjectType: "MATTER",
        subjectId: matter.id,
        title: "Solicitor submission approval",
        summary: "Review the case evidence and authorise submission.",
        actionKey: "matter.submit",
        riskLevel: "MEDIUM",
        approverUserId: user.id,
        allowSelfApproval: true,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        proposedPayload: { matterId: matter.id },
      },
    },
  );
  await post(page, "/api/automation-control/mutations", {
    operation: "approval.decide",
    organisationId,
    approvalId: approval.id,
    payload: {
      expectedVersion: approval.version,
      decision: "APPROVED",
      reason: "Evidence reviewed and submission authorised.",
    },
  });

  const blockedByException = await page.request.post(
    "/api/case-management/mutations",
    {
      headers: { Origin: new URL(page.url()).origin },
      data: {
        operation: "matter.status",
        organisationId,
        matterId: matter.id,
        payload: {
          toStatus: "SUBMITTED",
          reason: "Must fail while exception remains open",
          expectedVersion: matter.version,
        },
      },
    },
  );
  expect(blockedByException.status()).toBe(409);
  await post(page, "/api/service-lifecycle/mutations", {
    operation: "exception.resolve",
    organisationId,
    exceptionId: exception.id,
    resolution:
      "The missing evidence was obtained, checked and approved for submission.",
  });
  matter = await post<Versioned>(page, "/api/case-management/mutations", {
    operation: "matter.status",
    organisationId,
    matterId: matter.id,
    payload: {
      toStatus: "SUBMITTED",
      reason: "Payment, solicitor approval and exception controls cleared",
      expectedVersion: matter.version,
    },
  });

  matter = await post<Versioned>(page, "/api/case-management/mutations", {
    operation: "matter.status",
    organisationId,
    matterId: matter.id,
    payload: {
      toStatus: "DECISION_RECEIVED",
      reason: "Positive decision received",
      expectedVersion: matter.version,
    },
  });
  await recordPayment(2_000, "completion");
  const completion = await post<Versioned>(
    page,
    "/api/automation-control/mutations",
    {
      operation: "approval.create",
      organisationId,
      payload: {
        subjectType: "MATTER",
        subjectId: matter.id,
        title: "Matter completion approval",
        summary: "Approve final outcome, financial clearance and closure.",
        actionKey: "matter.complete",
        riskLevel: "MEDIUM",
        approverUserId: user.id,
        allowSelfApproval: true,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        proposedPayload: { outcome: "Application granted" },
      },
    },
  );
  await post(page, "/api/automation-control/mutations", {
    operation: "approval.decide",
    organisationId,
    approvalId: completion.id,
    payload: {
      expectedVersion: completion.version,
      decision: "APPROVED",
      reason: "Outcome and closing controls reviewed.",
    },
  });
  matter = await post<Versioned>(page, "/api/case-management/mutations", {
    operation: "matter.status",
    organisationId,
    matterId: matter.id,
    payload: {
      toStatus: "CLOSED",
      reason: "Service completed with all controls satisfied",
      outcome: "Application granted",
      expectedVersion: matter.version,
    },
  });
  expect(matter.status).toBe("CLOSED");

  const readinessResponse = await page.request.get(
    `/api/service-lifecycle?${new URLSearchParams({ organisationId, matterId: matter.id })}`,
  );
  expect(readinessResponse.status()).toBe(200);
  const readiness = (await readinessResponse.json()) as {
    completionPaymentCleared: boolean;
    completionApproved: boolean;
    outcomeRecorded: boolean;
    openExceptions: number;
  };
  expect(readiness).toMatchObject({
    completionPaymentCleared: true,
    completionApproved: true,
    outcomeRecorded: true,
    openExceptions: 0,
  });

  const foreign = await page.request.get(
    `/api/service-lifecycle?${new URLSearchParams({ organisationId: crypto.randomUUID(), matterId: matter.id })}`,
  );
  expect(foreign.status()).toBe(403);
  expect(foreign.headers()["cache-control"]).toContain("no-store");

  expect(issued.status).toBe("ISSUED");
});
