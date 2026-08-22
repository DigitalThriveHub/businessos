import { expect, test, type Page } from '@playwright/test';
import * as OTPAuth from 'otpauth';

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

function normaliseSecret(value: string): string {
  const secret = value.replace(/[\s-]/g, '').toUpperCase();
  if (secret.length < 16 || !/^[A-Z2-7]+=*$/.test(secret)) {
    throw new Error('E2E_CASE_USER_TOTP_SECRET is not valid Base32.');
  }
  return secret;
}

async function stableTotpCode(page: Page): Promise<string> {
  if (!totpSecret) throw new Error('E2E_CASE_USER_TOTP_SECRET is required.');
  const remaining = 30_000 - (Date.now() % 30_000);
  if (remaining < 5_000) await page.waitForTimeout(remaining + 300);
  return new OTPAuth.TOTP({
    issuer: 'BusinessOS',
    label: email ?? 'Case operations E2E',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(normaliseSecret(totpSecret)),
  }).generate();
}

async function signIn(page: Page): Promise<void> {
  if (!email || !password || !totpSecret) {
    throw new Error(
      'E2E_CASE_USER_EMAIL, E2E_CASE_USER_PASSWORD and E2E_CASE_USER_TOTP_SECRET must be configured.',
    );
  }
  await page.goto('/login?returnTo=%2Fdashboard');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();

  await page.waitForURL(/\/(dashboard|mfa\/challenge)/, { timeout: 20_000 });
  if (new URL(page.url()).pathname === '/mfa/challenge') {
    await page.getByLabel('Verification code').fill(await stableTotpCode(page));
    await page.getByRole('button', { name: 'Verify and continue' }).click();
  }
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
}

async function mutation<T>(page: Page, body: unknown): Promise<T> {
  const origin = new URL(page.url()).origin;
  const response = await page.request.post('/api/case-management/mutations', {
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    data: body,
  });
  const text = await response.text();
  expect(response.ok(), text).toBe(true);
  return JSON.parse(text) as T;
}

test.describe('case operations', () => {
  test('runs an authenticated task, deadline, request and tenant-isolation workflow', async ({
    page,
  }) => {
    test.skip(
      !email || !password || !totpSecret,
      'Dedicated AAL2 case-operations E2E credentials have not been configured.',
    );
    test.setTimeout(90_000);
    await signIn(page);

    const meResponse = await page.request.get('/api/auth/me');
    expect(meResponse.status()).toBe(200);
    const user = (await meResponse.json()) as WorkspaceUser;
    const requiredPermissions = [
      'clients.create',
      'clients.archive',
      'matters.create',
      'matters.status.manage',
      'tasks.create',
      'tasks.complete',
      'deadlines.create',
      'deadlines.manage',
      'document_requests.create',
      'document_requests.send',
    ];
    const organisation = user.organisations.find((value) => {
      if (value.organisationStatus.toUpperCase() !== 'ACTIVE') return false;
      const granted = new Set(
        value.permissions.map((permission) => permission.toLowerCase()),
      );
      return requiredPermissions.every((permission) => granted.has(permission));
    });
    test.skip(
      !organisation,
      'The E2E user has no active organisation with the complete case-operations test role.',
    );
    if (!organisation) throw new Error('Case-operations E2E organisation is missing.');

    const unique = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    let client: ClientRecord | null = null;
    let matter: MatterRecord | null = null;

    try {
      client = await mutation<ClientRecord>(page, {
        operation: 'client.create',
        organisationId: organisation.organisationId,
        payload: {
          kind: 'INDIVIDUAL',
          firstName: `E2E-${unique}`,
          lastName: 'Case Operations',
          email: `case-operations-${unique}@example.test`,
          processingLawfulBasis: 'CONTRACT',
          preferredLanguage: 'en-GB',
          preferredCommunication: 'EMAIL',
        },
      });

      matter = await mutation<MatterRecord>(page, {
        operation: 'matter.create',
        organisationId: organisation.organisationId,
        payload: {
          primaryClientId: client.id,
          title: `E2E controlled matter ${unique}`,
          description: 'Disposable authenticated browser test matter.',
          serviceType: 'Automated E2E verification',
          jurisdictionCountryCode: 'GB',
          priority: 'NORMAL',
        },
      });

      await page.goto(`/matters/${matter.id}`);
      await expect(
        page.getByRole('heading', { name: `E2E controlled matter ${unique}` }),
      ).toBeVisible({ timeout: 20_000 });

      const taskTitle = `Verify evidence ${unique}`;
      await page.getByLabel('Task title').fill(taskTitle);
      await page.getByLabel('Description').fill('Authenticated task lifecycle test.');
      await page.getByRole('button', { name: 'Create task' }).click();
      await expect(page.getByRole('status')).toContainText('Task created', {
        timeout: 15_000,
      });
      const taskCard = page.locator('article').filter({ hasText: taskTitle });
      await expect(taskCard).toBeVisible();
      page.once('dialog', (dialog) => dialog.accept('Verified by Playwright E2E.'));
      await taskCard.getByRole('button', { name: 'Complete' }).click();
      await expect(taskCard).toContainText('Completed', { timeout: 15_000 });

      await page.getByRole('button', { name: /Deadlines/ }).click();
      const deadlineTitle = `Controlled deadline ${unique}`;
      const dueAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000)
        .toISOString()
        .slice(0, 16);
      await page.getByLabel('Deadline title').fill(deadlineTitle);
      await page.getByLabel('Due time').fill(dueAt);
      await page.getByRole('button', { name: 'Create deadline' }).click();
      await expect(page.getByRole('status')).toContainText('Deadline created', {
        timeout: 15_000,
      });
      const deadlineCard = page.locator('article').filter({ hasText: deadlineTitle });
      page.once('dialog', (dialog) => dialog.accept('Deadline evidence verified.'));
      await deadlineCard.getByRole('button', { name: 'Satisfied' }).click();
      await expect(deadlineCard).toContainText('Satisfied', { timeout: 15_000 });

      await page.getByRole('button', { name: /Requests/ }).click();
      const requestTitle = `Evidence request ${unique}`;
      await page.getByLabel('Request title').fill(requestTitle);
      await page.getByPlaceholder('Document/item title').fill('Identity evidence');
      await page.getByRole('button', { name: 'Save draft' }).click();
      await expect(page.getByRole('status')).toContainText('Document request drafted', {
        timeout: 15_000,
      });
      const requestCard = page.locator('article').filter({ hasText: requestTitle });
      await requestCard.getByRole('button', { name: 'Issue request' }).click();
      await expect(requestCard).toContainText('Sent', { timeout: 15_000 });

      await page.getByRole('button', { name: /Timeline/ }).click();
      await expect(page.getByText('Task moved to COMPLETED.')).toBeVisible();
      await expect(page.getByText('Deadline moved to SATISFIED.')).toBeVisible();

      const foreignQuery = new URLSearchParams({
        organisationId: crypto.randomUUID(),
        matterId: matter.id,
      });
      const foreignResponse = await page.request.get(
        `/api/case-operations?${foreignQuery.toString()}`,
      );
      expect(foreignResponse.status()).toBe(403);
      expect(foreignResponse.headers()['cache-control']).toContain('no-store');
    } finally {
      if (matter) {
        const cancelled = await mutation<MatterRecord>(page, {
          operation: 'matter.status',
          organisationId: organisation.organisationId,
          matterId: matter.id,
          payload: {
            toStatus: 'CANCELLED',
            reason: 'Automated E2E cleanup.',
            outcome: 'Test lifecycle completed.',
            expectedVersion: matter.version,
          },
        });
        await mutation<MatterRecord>(page, {
          operation: 'matter.status',
          organisationId: organisation.organisationId,
          matterId: matter.id,
          payload: {
            toStatus: 'ARCHIVED',
            reason: 'Automated E2E test record archived.',
            outcome: null,
            expectedVersion: cancelled.version,
          },
        });
      }
      if (client) {
        await mutation<ClientRecord>(page, {
          operation: 'client.archive',
          organisationId: organisation.organisationId,
          clientId: client.id,
          payload: {
            reason: 'Automated E2E test record archived after verification.',
            expectedVersion: client.version,
          },
        });
      }
    }
  });
});