import { BadRequestException } from '@nestjs/common';

import type { OrganisationAccessContext } from '../auth/request-security-context';
import { AutomationControlService } from './automation-control.service';

const CONTEXT: Readonly<OrganisationAccessContext> = Object.freeze({
  userId: '11111111-1111-4111-8111-111111111111',
  organisationId: '22222222-2222-4222-8222-222222222222',
  membershipId: '33333333-3333-4333-8333-333333333333',
  sessionId: '44444444-4444-4444-8444-444444444444',
  aal: 'AAL2',
});

describe('AutomationControlService', () => {
  it('returns a strict empty control-tower view', async () => {
    const transaction = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          {
            readyWorkItems: 0n,
            atRiskSlas: 0n,
            breachedSlas: 0n,
            pendingApprovals: 0n,
            openEscalations: 0n,
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
    };
    const rls = {
      run: jest.fn(
        async (
          _context: unknown,
          callback: (value: typeof transaction) => Promise<unknown>,
        ) => callback(transaction),
      ),
    };
    const service = new AutomationControlService(rls as never);

    await expect(service.getControlTower(CONTEXT)).resolves.toMatchObject({
      summary: {
        readyWorkItems: 0,
        atRiskSlas: 0,
        breachedSlas: 0,
        pendingApprovals: 0,
        openEscalations: 0,
      },
      workItems: [],
      slas: [],
      escalations: [],
      approvals: [],
      policies: [],
    });
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(6);
  });

  it('completes a work item inside the verified RLS context', async () => {
    const completedAt = new Date('2026-08-21T12:00:00.000Z');
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          actionId: '55555555-5555-4555-8555-555555555555',
          workflowRunId: '66666666-6666-4666-8666-666666666666',
          actionStatus: 'SUCCEEDED',
          runStatus: 'COMPLETED',
          actionVersion: 2,
          completedAt,
        },
      ]),
    };
    const rls = {
      run: jest.fn(
        async (
          _context: unknown,
          callback: (value: typeof transaction) => Promise<unknown>,
        ) => callback(transaction),
      ),
    };
    const service = new AutomationControlService(rls as never);

    await expect(
      service.completeWorkItem(
        '55555555-5555-4555-8555-555555555555',
        { expectedVersion: 1, completionNote: 'Done.' },
        CONTEXT,
      ),
    ).resolves.toMatchObject({
      actionStatus: 'SUCCEEDED',
      actionVersion: 2,
      completedAt: completedAt.toISOString(),
    });
    expect(rls.run).toHaveBeenCalledWith(
      {
        userId: CONTEXT.userId,
        organisationId: CONTEXT.organisationId,
        aal: CONTEXT.aal,
      },
      expect.any(Function),
    );
  });

  it('rejects an approval expiry that is not safely in the future', async () => {
    const transaction = { $queryRaw: jest.fn() };
    const rls = {
      run: jest.fn(
        async (
          _context: unknown,
          callback: (value: typeof transaction) => Promise<unknown>,
        ) => callback(transaction),
      ),
    };
    const service = new AutomationControlService(rls as never);

    await expect(
      service.createApproval(
        {
          subjectType: 'MATTER',
          subjectId: '55555555-5555-4555-8555-555555555555',
          title: 'Approve action',
          summary: 'Review the controlled action.',
          actionKey: 'matter.submit',
          riskLevel: 'HIGH',
          approverUserId: '66666666-6666-4666-8666-666666666666',
          expiresAt: new Date().toISOString(),
        },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction.$queryRaw).not.toHaveBeenCalled();
  });

  it('rejects a linked action without its workflow run', async () => {
    const transaction = { $queryRaw: jest.fn() };
    const rls = {
      run: jest.fn(
        async (
          _context: unknown,
          callback: (value: typeof transaction) => Promise<unknown>,
        ) => callback(transaction),
      ),
    };
    const service = new AutomationControlService(rls as never);

    await expect(
      service.createApproval(
        {
          subjectType: 'MATTER',
          subjectId: '55555555-5555-4555-8555-555555555555',
          title: 'Approve action',
          summary: 'Review the controlled action.',
          actionKey: 'matter.submit',
          riskLevel: 'HIGH',
          approverUserId: '66666666-6666-4666-8666-666666666666',
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
          workflowActionId: '77777777-7777-4777-8777-777777777777',
        },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction.$queryRaw).not.toHaveBeenCalled();
  });

  it('prevents self approval for high-risk requests', async () => {
    const transaction = { $queryRaw: jest.fn() };
    const rls = {
      run: jest.fn(
        async (
          _context: unknown,
          callback: (value: typeof transaction) => Promise<unknown>,
        ) => callback(transaction),
      ),
    };
    const service = new AutomationControlService(rls as never);

    await expect(
      service.createApproval(
        {
          subjectType: 'MATTER',
          subjectId: '55555555-5555-4555-8555-555555555555',
          title: 'Approve action',
          summary: 'Review the controlled action.',
          actionKey: 'matter.submit',
          riskLevel: 'CRITICAL',
          approverUserId: CONTEXT.userId,
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
          allowSelfApproval: true,
        },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction.$queryRaw).not.toHaveBeenCalled();
  });

  it('materialises an approved AI communication as a draft in the same RLS transaction', async () => {
    const decidedAt = new Date('2026-08-25T10:00:00.000Z');
    const transaction = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          {
            approvalRequestId: '55555555-5555-4555-8555-555555555555',
            approvalStatus: 'APPROVED',
            approvalVersion: 2,
            decisionId: '66666666-6666-4666-8666-666666666666',
            decidedAt,
          },
        ])
        .mockResolvedValueOnce([
          {
            materialise_approved_ai_draft:
              '77777777-7777-4777-8777-777777777777',
          },
        ]),
    };
    const rls = {
      run: jest.fn(
        async (
          _context: unknown,
          callback: (value: typeof transaction) => Promise<unknown>,
        ) => callback(transaction),
      ),
    };
    const service = new AutomationControlService(rls as never);

    await expect(
      service.decideApproval(
        '55555555-5555-4555-8555-555555555555',
        {
          expectedVersion: 1,
          decision: 'APPROVED',
          reason: 'Reviewed and approved as a draft only.',
        },
        CONTEXT,
      ),
    ).resolves.toMatchObject({
      approvalStatus: 'APPROVED',
      decidedAt: decidedAt.toISOString(),
    });
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
    expect(rls.run).toHaveBeenCalledTimes(1);
  });
});
