import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import type { OrganisationAccessContext } from '../auth/request-security-context';
import { RlsTransactionService } from '../database/rls-transaction.service';
import { OrganisationsService } from './organisations.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';

const ORGANISATION_ID = '22222222-2222-4222-8222-222222222222';

const MEMBERSHIP_ID = '33333333-3333-4333-8333-333333333333';

const SESSION_ID = '44444444-4444-4444-8444-444444444444';

const CONTEXT: Readonly<OrganisationAccessContext> = Object.freeze({
  userId: USER_ID,
  organisationId: ORGANISATION_ID,
  membershipId: MEMBERSHIP_ID,
  sessionId: SESSION_ID,
  aal: 'AAL2',
});

const DATABASE_ORGANISATION = {
  id: ORGANISATION_ID,
  name: 'Example Legal Services',
  legalName: 'Example Legal Services Limited',
  slug: 'example-legal-services',
  status: 'ACTIVE',
  timezone: 'Europe/London',
  locale: 'en-GB',
  countryCode: 'GB',
  createdAt: new Date('2026-08-17T10:00:00.000Z'),
  updatedAt: new Date('2026-08-17T11:00:00.000Z'),
};

const EXPECTED_ORGANISATION = {
  id: ORGANISATION_ID,
  name: 'Example Legal Services',
  legalName: 'Example Legal Services Limited',
  slug: 'example-legal-services',
  status: 'ACTIVE',
  timezone: 'Europe/London',
  locale: 'en-GB',
  countryCode: 'GB',
  createdAt: '2026-08-17T10:00:00.000Z',
  updatedAt: '2026-08-17T11:00:00.000Z',
};

describe('OrganisationsService', () => {
  let service: OrganisationsService;

  let rls: {
    run: jest.Mock;
  };

  let transaction: {
    organisation: {
      findFirst: jest.Mock;
    };
    $queryRaw: jest.Mock;
  };

  beforeEach(async () => {
    transaction = {
      organisation: {
        findFirst: jest.fn(),
      },
      $queryRaw: jest.fn(),
    };

    rls = {
      run: jest.fn(
        async (
          _context: unknown,
          operation: (client: typeof transaction) => Promise<unknown>,
        ) => operation(transaction),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganisationsService,
        {
          provide: RlsTransactionService,
          useValue: rls,
        },
      ],
    }).compile();

    service = module.get<OrganisationsService>(OrganisationsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is created with the RLS dependency', () => {
    expect(service).toBeDefined();
  });

  it('returns the organisation through verified tenant RLS', async () => {
    transaction.organisation.findFirst.mockResolvedValue(DATABASE_ORGANISATION);

    await expect(service.findCurrent(CONTEXT)).resolves.toEqual(
      EXPECTED_ORGANISATION,
    );

    expect(rls.run).toHaveBeenCalledWith(
      {
        userId: USER_ID,
        organisationId: ORGANISATION_ID,
        aal: 'AAL2',
      },
      expect.any(Function),
    );

    expect(transaction.organisation.findFirst).toHaveBeenCalledWith({
      where: {
        id: ORGANISATION_ID,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        legalName: true,
        slug: true,
        status: true,
        timezone: true,
        locale: true,
        countryCode: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  });

  it('returns not found when the organisation is unavailable', async () => {
    transaction.organisation.findFirst.mockResolvedValue(null);

    await expect(service.findCurrent(CONTEXT)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects an empty organisation update', async () => {
    await expect(service.updateCurrent({}, CONTEXT)).rejects.toThrow(
      BadRequestException,
    );

    expect(rls.run).not.toHaveBeenCalled();
  });

  it('updates the organisation using the secured database function', async () => {
    transaction.$queryRaw.mockResolvedValue([
      {
        organisation: {
          ...EXPECTED_ORGANISATION,
          name: 'Updated Legal Services',
          updatedAt: '2026-08-17T12:00:00.000Z',
        },
      },
    ]);

    await expect(
      service.updateCurrent(
        {
          name: 'Updated Legal Services',
        },
        CONTEXT,
      ),
    ).resolves.toEqual({
      ...EXPECTED_ORGANISATION,
      name: 'Updated Legal Services',
      updatedAt: '2026-08-17T12:00:00.000Z',
    });

    expect(rls.run).toHaveBeenCalledWith(
      {
        userId: USER_ID,
        organisationId: ORGANISATION_ID,
        aal: 'AAL2',
      },
      expect.any(Function),
    );

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('maps database permission denial to forbidden', async () => {
    transaction.$queryRaw.mockRejectedValue({
      code: 'P2010',
      meta: {
        code: '42501',
      },
    });

    await expect(
      service.updateCurrent(
        {
          name: 'Denied Update',
        },
        CONTEXT,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('maps a duplicate organisation URL to conflict', async () => {
    transaction.$queryRaw.mockRejectedValue({
      code: 'P2010',
      meta: {
        code: '23505',
      },
    });

    await expect(
      service.updateCurrent(
        {
          slug: 'existing-organisation',
        },
        CONTEXT,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects an invalid secured-function response', async () => {
    transaction.$queryRaw.mockResolvedValue([
      {
        organisation: {
          invalid: true,
        },
      },
    ]);

    await expect(
      service.updateCurrent(
        {
          name: 'Updated Legal Services',
        },
        CONTEXT,
      ),
    ).rejects.toThrow(InternalServerErrorException);
  });
});
