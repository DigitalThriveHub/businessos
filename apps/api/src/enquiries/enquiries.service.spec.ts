import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RlsTransactionService } from '../database/rls-transaction.service';
import { EnquiriesService } from './enquiries.service';

describe('EnquiriesService', () => {
  let service: EnquiriesService;
  let rls: {
    run: jest.Mock;
  };

  const context = {
    userId: '11111111-1111-4111-8111-111111111111',
    organisationId: '22222222-2222-4222-8222-222222222222',
    aal: 'AAL1' as const,
  };

  const enquiryId =
    '33333333-3333-4333-8333-333333333333';

  beforeEach(async () => {
    rls = {
      run: jest.fn(),
    };

    const module: TestingModule =
      await Test.createTestingModule({
        providers: [
          EnquiriesService,
          {
            provide: RlsTransactionService,
            useValue: rls,
          },
        ],
      }).compile();

    service = module.get<EnquiriesService>(
      EnquiriesService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is created with the RLS transaction dependency', () => {
    expect(service).toBeDefined();
  });

  it('runs enquiry listing through the authenticated RLS boundary', async () => {
    const transaction = {
      enquiry: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    rls.run.mockImplementation(
      async (
        suppliedContext: typeof context,
        operation: (
          client: typeof transaction,
        ) => Promise<unknown>,
      ) => {
        expect(suppliedContext).toEqual(context);

        return operation(transaction);
      },
    );

    await expect(
      service.findAll(
        {
          organisationId: context.organisationId,
          page: 1,
          limit: 20,
        },
        context,
      ),
    ).resolves.toEqual({
      items: [],
      pagination: {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      },
    });

    expect(rls.run).toHaveBeenCalledTimes(1);

    expect(
      transaction.enquiry.findMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organisationId: context.organisationId,
          deletedAt: null,
        }),
        skip: 0,
        take: 20,
        orderBy: {
          createdAt: 'desc',
        },
      }),
    );

    expect(
      transaction.enquiry.count,
    ).toHaveBeenCalledWith({
      where: expect.objectContaining({
        organisationId: context.organisationId,
        deletedAt: null,
      }),
    });
  });

  it('soft-deletes an enquiry through the protected database function', async () => {
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          deleted: true,
        },
      ]),
    };

    rls.run.mockImplementation(
      async (
        suppliedContext: typeof context,
        operation: (
          client: typeof transaction,
        ) => Promise<unknown>,
      ) => {
        expect(suppliedContext).toEqual(context);

        return operation(transaction);
      },
    );

    await expect(
      service.remove(enquiryId, context),
    ).resolves.toEqual({
      message: 'Enquiry deleted successfully',
    });

    expect(rls.run).toHaveBeenCalledTimes(1);
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);

    const queryCall =
      transaction.$queryRaw.mock.calls[0];

    expect(
      Array.from(
        queryCall[0] as TemplateStringsArray,
      ).join(''),
    ).toContain('private.soft_delete_enquiry');

    expect(queryCall[1]).toBe(enquiryId);
    expect(queryCall[2]).toBe(
      context.organisationId,
    );
  });

  it('returns not found when the database function does not delete an enquiry', async () => {
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          deleted: false,
        },
      ]),
    };

    rls.run.mockImplementation(
      async (
        suppliedContext: typeof context,
        operation: (
          client: typeof transaction,
        ) => Promise<unknown>,
      ) => {
        expect(suppliedContext).toEqual(context);

        return operation(transaction);
      },
    );

    await expect(
      service.remove(enquiryId, context),
    ).rejects.toThrow(NotFoundException);

    expect(rls.run).toHaveBeenCalledTimes(1);
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);

    const queryCall =
      transaction.$queryRaw.mock.calls[0];

    expect(queryCall[1]).toBe(enquiryId);
    expect(queryCall[2]).toBe(
      context.organisationId,
    );
  });
});