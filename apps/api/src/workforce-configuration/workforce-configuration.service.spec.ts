import { BadRequestException, ConflictException } from '@nestjs/common';

import type { OrganisationAccessContext } from '../auth/request-security-context';
import { RlsTransactionService } from '../database/rls-transaction.service';
import { Prisma } from '../generated/prisma/client';
import {
  AgentAuthorityLevel,
  PermissionDataScope,
} from '../generated/prisma/enums';
import type {
  CreateAgentPolicyDto,
  CreateAgentProfileDto,
  CreateJobProfileKpiDto,
  UpdateDepartmentDto,
} from './dto/workforce-configuration.dto';
import { WorkforceConfigurationService } from './workforce-configuration.service';

const CONTEXT: Readonly<OrganisationAccessContext> = Object.freeze({
  userId: '11111111-1111-4111-8111-111111111111',
  organisationId: '22222222-2222-4222-8222-222222222222',
  membershipId: '33333333-3333-4333-8333-333333333333',
  sessionId: '44444444-4444-4444-8444-444444444444',
  aal: 'AAL2',
});

describe('WorkforceConfigurationService', () => {
  const rlsMock = { run: jest.fn() };
  let service: WorkforceConfigurationService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new WorkforceConfigurationService(
      rlsMock as unknown as RlsTransactionService,
    );
  });

  it('creates a tenant department and writes an audit event atomically', async () => {
    const createdAt = new Date('2026-08-20T10:00:00.000Z');
    const transaction = {
      department: {
        create: jest.fn().mockResolvedValue({
          id: '55555555-5555-4555-8555-555555555555',
          updatedAt: createdAt,
        }),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    rlsMock.run.mockImplementation(
      async (_context, callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
    );

    await expect(
      service.createDepartment(
        { name: 'Client Services', code: 'CLIENT-SERVICES' },
        CONTEXT,
      ),
    ).resolves.toEqual({
      resource: 'department',
      id: '55555555-5555-4555-8555-555555555555',
      version: null,
      updatedAt: createdAt.toISOString(),
    });

    expect(rlsMock.run).toHaveBeenCalledWith(
      {
        userId: CONTEXT.userId,
        organisationId: CONTEXT.organisationId,
        aal: CONTEXT.aal,
      },
      expect.any(Function),
    );
    expect(transaction.department.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organisationId: CONTEXT.organisationId,
          name: 'Client Services',
        }),
      }),
    );
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('rejects stale optimistic-lock timestamps without overwriting data', async () => {
    const transaction = {
      department: {
        findFirst: jest.fn().mockResolvedValue({
          id: '55555555-5555-4555-8555-555555555555',
          parentId: null,
          name: 'Operations',
          code: 'OPS',
          description: null,
          isActive: true,
          updatedAt: new Date('2026-08-20T10:00:00.000Z'),
        }),
        updateMany: jest.fn(),
      },
    };
    rlsMock.run.mockImplementation(
      async (_context, callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
    );
    const dto: UpdateDepartmentDto = {
      name: 'Operations',
      code: 'OPS',
      description: null,
      parentId: null,
      isActive: true,
      expectedUpdatedAt: '2026-08-20T09:59:59.000Z',
    };

    await expect(
      service.updateDepartment(
        '55555555-5555-4555-8555-555555555555',
        dto,
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(transaction.department.updateMany).not.toHaveBeenCalled();
  });

  it('rejects impossible KPI numeric ranges before opening a transaction', async () => {
    const dto: CreateJobProfileKpiDto = {
      kpiDefinitionId: '55555555-5555-4555-8555-555555555555',
      targetValue: '20',
      minimumValue: '30',
      maximumValue: '40',
      weightPercent: 25,
    };

    await expect(
      service.createJobProfileKpi(
        '66666666-6666-4666-8666-666666666666',
        dto,
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rlsMock.run).not.toHaveBeenCalled();
  });

  it('enforces overlapping KPI weight limits over effective time windows', async () => {
    const transaction = {
      jobProfile: {
        findFirst: jest.fn().mockResolvedValue({
          id: '66666666-6666-4666-8666-666666666666',
          departmentId: null,
          version: 1,
          isActive: true,
        }),
      },
      kpiDefinition: {
        findFirst: jest.fn().mockResolvedValue({
          id: '55555555-5555-4555-8555-555555555555',
          departmentId: null,
        }),
      },
      jobProfileKpi: {
        findMany: jest.fn().mockResolvedValue([
          {
            startsAt: new Date('2026-08-01T00:00:00.000Z'),
            endsAt: null,
            weightPercent: new Prisma.Decimal(80),
          },
        ]),
        create: jest.fn(),
      },
    };
    rlsMock.run.mockImplementation(
      async (_context, callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
    );

    await expect(
      service.createJobProfileKpi(
        '66666666-6666-4666-8666-666666666666',
        {
          kpiDefinitionId: '55555555-5555-4555-8555-555555555555',
          weightPercent: 25,
          startsAt: '2026-08-20T00:00:00.000Z',
        },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(transaction.jobProfileKpi.create).not.toHaveBeenCalled();
  });

  it('rejects contradictory automatic-execution profile controls', async () => {
    const dto: CreateAgentProfileDto = {
      key: 'case-worker-agent',
      name: 'Case Worker Agent',
      description: 'Assists assigned case workers.',
      behaviourInstructions: 'Draft evidence-based responses only.',
      authorityCeiling: AgentAuthorityLevel.EXECUTE_AUTOMATIC,
      requiresHumanReview: true,
    };

    await expect(service.createAgentProfile(dto, CONTEXT)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(rlsMock.run).not.toHaveBeenCalled();
  });

  it('prevents AI policy data-scope escalation', async () => {
    const transaction = {
      agentProfile: {
        findFirst: jest.fn().mockResolvedValue({
          id: '55555555-5555-4555-8555-555555555555',
          authorityCeiling: AgentAuthorityLevel.EXECUTE_AUTOMATIC,
          requiresHumanReview: false,
          version: 1,
        }),
      },
      permission: {
        findFirst: jest.fn().mockResolvedValue({
          key: 'clients.read',
          dataScope: PermissionDataScope.SHARED,
          requiresMfa: false,
        }),
      },
      agentPolicy: { create: jest.fn() },
    };
    rlsMock.run.mockImplementation(
      async (_context, callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
    );
    const dto: CreateAgentPolicyDto = {
      toolKey: 'crm.clients.read',
      requiredPermissionKey: 'clients.read',
      authorityLevel: AgentAuthorityLevel.READ,
      maximumDataScope: PermissionDataScope.ORGANISATION,
      requiresApproval: false,
      requiresMfa: false,
      maxActionsPerRun: 25,
    };

    await expect(
      service.createAgentPolicy(
        '55555555-5555-4555-8555-555555555555',
        dto,
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(transaction.agentPolicy.create).not.toHaveBeenCalled();
  });

  it('prevents AI policies from weakening permission MFA', async () => {
    const transaction = {
      agentProfile: {
        findFirst: jest.fn().mockResolvedValue({
          id: '55555555-5555-4555-8555-555555555555',
          authorityCeiling: AgentAuthorityLevel.PROPOSE,
          requiresHumanReview: true,
          version: 1,
        }),
      },
      permission: {
        findFirst: jest.fn().mockResolvedValue({
          key: 'clients.read',
          dataScope: PermissionDataScope.ASSIGNED,
          requiresMfa: true,
        }),
      },
      agentPolicy: { create: jest.fn() },
    };
    rlsMock.run.mockImplementation(
      async (_context, callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
    );

    await expect(
      service.createAgentPolicy(
        '55555555-5555-4555-8555-555555555555',
        {
          toolKey: 'crm.clients.read',
          requiredPermissionKey: 'clients.read',
          authorityLevel: AgentAuthorityLevel.READ,
          maximumDataScope: PermissionDataScope.ASSIGNED,
          requiresApproval: false,
          requiresMfa: false,
          maxActionsPerRun: 25,
        },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(transaction.agentPolicy.create).not.toHaveBeenCalled();
  });
});