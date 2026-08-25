/// <reference types="jest" />

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { BootstrapService } from './bootstrap.service';
import { BootstrapOrganisationDto } from './dto/bootstrap-organisation.dto';

describe('BootstrapService', () => {
  const actor = {
    userId: '00000000-0000-4000-8000-000000000001',
    email: 'owner@example.com',
  };

  const dto: BootstrapOrganisationDto = {
    name: 'Example Legal',
    slug: 'example-legal',
    legalName: 'Example Legal Limited',
    ownerEmail: 'owner@example.com',
    ownerDisplayName: 'Example Owner',
    ownerFirstName: 'Example',
    ownerLastName: 'Owner',
    ownerJobTitle: 'Director',
    timezone: 'Europe/London',
    locale: 'en-GB',
    countryCode: 'GB',
  };

  const databaseResult = {
    organisation_id: '00000000-0000-4000-8000-000000000100',
    organisation_slug: 'example-legal',
    membership_id: '00000000-0000-4000-8000-000000000200',
    owner_role_id: '00000000-0000-4000-8000-000000000300',
    owner_role_assignment_id: '00000000-0000-4000-8000-000000000400',
    status: 'ACTIVE',
  };

  const rlsTransaction = {
    run: jest.fn(),
  };

  let service: BootstrapService;

  beforeEach(() => {
    jest.clearAllMocks();

    service = new BootstrapService(rlsTransaction as never);

    rlsTransaction.run.mockImplementation(
      async (
        _context: unknown,
        operation: (transaction: { $queryRaw: jest.Mock }) => Promise<unknown>,
      ) =>
        operation({
          $queryRaw: jest.fn().mockResolvedValue([databaseResult]),
        }),
    );
  });

  it('bootstraps an organisation atomically', async () => {
    const result = await service.bootstrapOrganisation(actor, dto);

    expect(rlsTransaction.run).toHaveBeenCalledWith(
      {
        userId: actor.userId,
        aal: 'AAL1',
      },
      expect.any(Function),
    );

    expect(result).toEqual({
      organisationId: databaseResult.organisation_id,
      organisationSlug: databaseResult.organisation_slug,
      membershipId: databaseResult.membership_id,
      ownerRoleId: databaseResult.owner_role_id,
      ownerRoleAssignmentId: databaseResult.owner_role_assignment_id,
      status: 'ACTIVE',
    });
  });

  it('normalises matching owner email addresses', async () => {
    await expect(
      service.bootstrapOrganisation(
        {
          ...actor,
          email: ' OWNER@EXAMPLE.COM ',
        },
        {
          ...dto,
          ownerEmail: ' owner@example.com ',
        },
      ),
    ).resolves.toMatchObject({
      status: 'ACTIVE',
    });
  });

  it('rejects an owner email mismatch before database access', async () => {
    await expect(
      service.bootstrapOrganisation(actor, {
        ...dto,
        ownerEmail: 'different@example.com',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(rlsTransaction.run).not.toHaveBeenCalled();
  });

  it('maps a database uniqueness violation to conflict', async () => {
    const error = Object.assign(new Error('Unique constraint violation'), {
      meta: {
        code: '23505',
      },
    });

    rlsTransaction.run.mockRejectedValue(error);

    await expect(
      service.bootstrapOrganisation(actor, dto),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('maps a database validation violation to bad request', async () => {
    const error = Object.assign(new Error('Invalid organisation slug'), {
      meta: {
        code: '23514',
      },
    });

    rlsTransaction.run.mockRejectedValue(error);

    await expect(
      service.bootstrapOrganisation(actor, dto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps a portal-only bootstrap denial to forbidden', async () => {
    const error = Object.assign(
      new Error('Client portal identities cannot bootstrap organisations'),
      {
        meta: {
          code: '42501',
        },
      },
    );

    rlsTransaction.run.mockRejectedValue(error);

    await expect(
      service.bootstrapOrganisation(actor, dto),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not expose unexpected database errors', async () => {
    rlsTransaction.run.mockRejectedValue(
      new Error('Sensitive database information'),
    );

    await expect(
      service.bootstrapOrganisation(actor, dto),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    await expect(service.bootstrapOrganisation(actor, dto)).rejects.toThrow(
      'Organisation bootstrap failed.',
    );
  });

  it('rejects an invalid database result', async () => {
    rlsTransaction.run.mockResolvedValue([]);

    await expect(service.bootstrapOrganisation(actor, dto)).rejects.toThrow(
      'Organisation bootstrap returned an invalid result.',
    );
  });
});
