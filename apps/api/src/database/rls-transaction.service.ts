import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from './prisma.service';

export interface RlsContext {
  userId: string;
  organisationId?: string;
  supportGrantId?: string;
  aal: 'AAL1' | 'AAL2';
}

@Injectable()
export class RlsTransactionService {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(
    context: RlsContext,
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
          SELECT
            set_config('app.user_id', ${context.userId}, true),
            set_config(
              'app.organisation_id',
              ${context.organisationId ?? ''},
              true
            ),
            set_config(
              'app.support_grant_id',
              ${context.supportGrantId ?? ''},
              true
            ),
            set_config('app.aal', ${context.aal}, true)
        `;

        return operation(transaction);
      },
      {
        maxWait: 5_000,
        timeout: 15_000,
      },
    );
  }
}