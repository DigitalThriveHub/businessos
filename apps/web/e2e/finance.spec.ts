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
type ClientRecord = { id: string; version: number };
type MatterRecord = { id: string; version: number };
type FinanceSettings = {
  legalName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string;
  vatScheme: string;
  vatRegistrationNumber: string | null;
  baseCurrency: string;
  invoicePrefix: string;
  creditNotePrefix: string;
  paymentPrefix: string;
  paymentTermsDays: number;
  paymentInstructions: string | null;
  version: number;
};
type FinanceDashboard = {
  settings: FinanceSettings;
  documents: Array<{
    id: string;
    documentNumber: string | null;
    status: string;
    version: number;
    totalMinor: string;
    balanceMinor: string;
  }>;
  journal: Array<{ debitMinor: string; creditMinor: string }>;
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
    label: email ?? "Finance E2E",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(normaliseSecret(totpSecret)),
  }).generate();
}

async function signIn(page: Page): Promise<void> {
  if (!email || !password || !totpSecret) {
    throw new Error("Dedicated AAL2 finance E2E credentials are required.");
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

async function financeDashboard(
  page: Page,
  organisationId: string,
): Promise<FinanceDashboard> {
  const response = await page.request.get(
    `/api/finance?${new URLSearchParams({ organisationId }).toString()}`,
  );
  const text = await response.text();
  expect(response.ok(), text).toBe(true);
  return JSON.parse(text) as FinanceDashboard;
}

function settingsPayload(settings: FinanceSettings) {
  return {
    expectedVersion: settings.version,
    legalName: settings.legalName,
    addressLine1: settings.addressLine1,
    addressLine2: settings.addressLine2,
    city: settings.city,
    region: settings.region,
    postalCode: settings.postalCode,
    countryCode: settings.countryCode,
    vatScheme: settings.vatScheme,
    vatRegistrationNumber: settings.vatRegistrationNumber,
    baseCurrency: settings.baseCurrency,
    invoicePrefix: settings.invoicePrefix,
    creditNotePrefix: settings.creditNotePrefix,
    paymentPrefix: settings.paymentPrefix,
    paymentTermsDays: settings.paymentTermsDays,
    paymentInstructions: settings.paymentInstructions,
  };
}

test.describe("Gate E finance", () => {
  test("issues a VAT invoice, allocates payment, posts balanced journals and isolates tenants", async ({
    page,
  }) => {
    test.skip(
      !email || !password || !totpSecret,
      "Dedicated AAL2 Gate E credentials are not configured.",
    );
    test.setTimeout(120_000);
    await signIn(page);

    const me = await page.request.get("/api/auth/me");
    expect(me.status()).toBe(200);
    const user = (await me.json()) as WorkspaceUser;
    const required = [
      "clients.create",
      "clients.archive",
      "matters.create",
      "matters.status.manage",
      "finance.read",
      "finance.settings.manage",
      "invoices.create",
      "invoices.issue",
      "payments.record",
      "ledger.read",
    ];
    const organisation = user.organisations.find((entry) => {
      const permissions = new Set(
        entry.permissions.map((permission) => permission.toLowerCase()),
      );
      return (
        entry.organisationStatus.toUpperCase() === "ACTIVE" &&
        required.every((permission) => permissions.has(permission))
      );
    });
    test.skip(!organisation, "The Gate E E2E role is incomplete.");
    if (!organisation) throw new Error("Gate E organisation is missing.");

    const unique = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const original = (await financeDashboard(page, organisation.organisationId))
      .settings;
    let settingsChanged = false;
    let client: ClientRecord | null = null;
    let matter: MatterRecord | null = null;

    try {
      await post(page, "/api/finance/mutations", {
        operation: "settings.update",
        organisationId: organisation.organisationId,
        payload: {
          expectedVersion: original.version,
          legalName: "BusinessOS Gate E Test Ltd",
          addressLine1: "1 Test Street",
          addressLine2: null,
          city: "London",
          region: null,
          postalCode: "SW1A 1AA",
          countryCode: "GB",
          vatScheme: "STANDARD",
          vatRegistrationNumber: "GB123456789",
          baseCurrency: "GBP",
          invoicePrefix: "INV",
          creditNotePrefix: "CRN",
          paymentPrefix: "PAY",
          paymentTermsDays: 14,
          paymentInstructions: "Automated staging evidence only.",
        },
      });
      settingsChanged = true;

      client = await post<ClientRecord>(
        page,
        "/api/case-management/mutations",
        {
          operation: "client.create",
          organisationId: organisation.organisationId,
          payload: {
            kind: "INDIVIDUAL",
            firstName: `GateE-${unique}`,
            lastName: "Finance",
            email: `gate-e-${unique}@example.test`,
            processingLawfulBasis: "CONTRACT",
            preferredLanguage: "en-GB",
            preferredCommunication: "EMAIL",
          },
        },
      );
      matter = await post<MatterRecord>(
        page,
        "/api/case-management/mutations",
        {
          operation: "matter.create",
          organisationId: organisation.organisationId,
          payload: {
            primaryClientId: client.id,
            title: `Gate E finance ${unique}`,
            serviceType: "Finance acceptance",
            jurisdictionCountryCode: "GB",
            priority: "NORMAL",
          },
        },
      );

      const draft = await post<{
        id: string;
        status: string;
        totalMinor: string;
        version: number;
      }>(page, "/api/finance/mutations", {
        operation: "document.create",
        organisationId: organisation.organisationId,
        payload: {
          clientId: client.id,
          matterId: matter.id,
          documentType: "INVOICE",
          currencyCode: "GBP",
          reference: `Gate E ${unique}`,
          clientVisible: true,
          lines: [
            {
              description: "Professional services",
              quantityMilli: 1000,
              unitAmountMinor: 10_000,
              taxCategory: "STANDARD",
              vatRateBasisPoints: 2000,
            },
          ],
        },
      });
      expect(draft.status).toBe("DRAFT");
      expect(draft.totalMinor).toBe("12000");

      const issued = await post<{
        id: string;
        documentNumber: string;
        status: string;
        version: number;
      }>(page, "/api/finance/mutations", {
        operation: "document.issue",
        organisationId: organisation.organisationId,
        documentId: draft.id,
        payload: { expectedVersion: draft.version },
      });
      expect(issued.status).toBe("ISSUED");
      expect(issued.documentNumber).toMatch(/^INV-\d{8}$/);

      const payment = await post<{
        paymentNumber: string;
        amountMinor: string;
      }>(page, "/api/finance/mutations", {
        operation: "payment.record",
        organisationId: organisation.organisationId,
        payload: {
          clientId: client.id,
          paymentType: "RECEIPT",
          method: "BANK_TRANSFER",
          currencyCode: "GBP",
          amountMinor: 12_000,
          occurredAt: new Date().toISOString(),
          reference: `Gate E receipt ${unique}`,
          idempotencyKey: `gate-e/${unique}`,
          allocations: [{ documentId: draft.id, amountMinor: 12_000 }],
        },
      });
      expect(payment.paymentNumber).toMatch(/^PAY-\d{8}$/);
      expect(payment.amountMinor).toBe("12000");

      const result = await financeDashboard(page, organisation.organisationId);
      const paid = result.documents.find(
        (document) => document.id === draft.id,
      );
      expect(paid?.status).toBe("PAID");
      expect(paid?.balanceMinor).toBe("0");
      expect(result.journal.length).toBeGreaterThanOrEqual(2);
      for (const entry of result.journal) {
        expect(entry.debitMinor).toBe(entry.creditMinor);
      }

      await page.goto("/finance");
      await expect(
        page.getByRole("heading", { name: "Finance", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(issued.documentNumber, { exact: false }).first(),
      ).toBeVisible();

      const foreign = await page.request.get(
        `/api/finance?${new URLSearchParams({
          organisationId: crypto.randomUUID(),
        }).toString()}`,
      );
      expect(foreign.status()).toBe(403);
      expect(foreign.headers()["cache-control"]).toContain("no-store");
    } finally {
      if (settingsChanged) {
        const current = (
          await financeDashboard(page, organisation.organisationId)
        ).settings;
        await post(page, "/api/finance/mutations", {
          operation: "settings.update",
          organisationId: organisation.organisationId,
          payload: {
            ...settingsPayload(original),
            expectedVersion: current.version,
          },
        });
      }
      if (matter) {
        const cancelled = await post<MatterRecord>(
          page,
          "/api/case-management/mutations",
          {
            operation: "matter.status",
            organisationId: organisation.organisationId,
            matterId: matter.id,
            payload: {
              toStatus: "CANCELLED",
              reason: "Gate E E2E cleanup.",
              outcome: "Finance evidence verified.",
              expectedVersion: matter.version,
            },
          },
        );
        await post(page, "/api/case-management/mutations", {
          operation: "matter.status",
          organisationId: organisation.organisationId,
          matterId: matter.id,
          payload: {
            toStatus: "ARCHIVED",
            reason: "Gate E E2E record archived.",
            outcome: null,
            expectedVersion: cancelled.version,
          },
        });
      }
      if (client) {
        await post(page, "/api/case-management/mutations", {
          operation: "client.archive",
          organisationId: organisation.organisationId,
          clientId: client.id,
          payload: {
            reason: "Gate E E2E record archived.",
            expectedVersion: client.version,
          },
        });
      }
    }
  });
});
