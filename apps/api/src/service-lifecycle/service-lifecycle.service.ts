import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import type { OrganisationAccessContext } from '../auth/request-security-context';
import { RlsTransactionService } from '../database/rls-transaction.service';

@Injectable()
export class ServiceLifecycleService {
  constructor(private readonly rls: RlsTransactionService) {}
  async dashboard(context: Readonly<OrganisationAccessContext>) {
    try {
      const rows = await this.rls.run(
        {
          userId: context.userId,
          organisationId: context.organisationId,
          aal: context.aal,
        },
        (tx) =>
          tx.$queryRaw<
            { dashboard: unknown }[]
          >`SELECT private.get_service_lifecycle_dashboard() AS dashboard`,
      );
      if (rows.length !== 1)
        throw new InternalServerErrorException('Invalid lifecycle response.');
      return rows[0]?.dashboard;
    } catch (error) {
      if (error instanceof InternalServerErrorException) throw error;
      throw new ForbiddenException(
        'The service lifecycle is unavailable or access is denied.',
      );
    }
  }
  async create(
    input: {
      matterId: string;
      professionalFeeMinor: number;
      governmentFeeMinor: number;
      initialPaymentMinor: number;
      submissionClearanceMinor: number;
      termsVersion: string;
      instalments: unknown[];
    },
    context: Readonly<OrganisationAccessContext>,
  ) {
    const rows = await this.rls.run(
      {
        userId: context.userId,
        organisationId: context.organisationId,
        aal: context.aal,
      },
      (tx) =>
        tx.$queryRaw<
          { id: string }[]
        >`SELECT private.create_service_engagement(${input.matterId}::uuid,${input.professionalFeeMinor}::bigint,${input.governmentFeeMinor}::bigint,${input.initialPaymentMinor}::bigint,${input.submissionClearanceMinor}::bigint,${input.termsVersion},${JSON.stringify(input.instalments)}::jsonb) AS id`,
    );
    return { id: rows[0]?.id };
  }
  async accept(id: string, context: Readonly<OrganisationAccessContext>) {
    await this.rls.run(
      {
        userId: context.userId,
        organisationId: context.organisationId,
        aal: context.aal,
      },
      (tx) =>
        tx.$executeRaw`SELECT private.accept_service_engagement(${id}::uuid)`,
    );
    return { accepted: true };
  }
  async override(
    input: {
      engagementId: string;
      gate: 'LEGAL_WORK' | 'SUBMISSION' | 'CLOSURE';
      reason: string;
      expiresAt: string;
    },
    context: Readonly<OrganisationAccessContext>,
  ) {
    const rows = await this.rls.run(
      {
        userId: context.userId,
        organisationId: context.organisationId,
        aal: context.aal,
      },
      (tx) =>
        tx.$queryRaw<
          { id: string }[]
        >`SELECT private.approve_lifecycle_override(${input.engagementId}::uuid,${input.gate}::public.lifecycle_gate,${input.reason},${input.expiresAt}::timestamptz) AS id`,
    );
    return { id: rows[0]?.id };
  }

  async readiness(
    matterId: string,
    context: Readonly<OrganisationAccessContext>,
  ) {
    const rows = await this.rls.run(
      {
        userId: context.userId,
        organisationId: context.organisationId,
        aal: context.aal,
      },
      (tx) =>
        tx.$queryRaw<
          { readiness: unknown }[]
        >`SELECT private.get_matter_lifecycle_readiness(${matterId}::uuid) AS readiness`,
    );
    if (rows.length !== 1) {
      throw new InternalServerErrorException('Invalid readiness response.');
    }
    return rows[0]?.readiness;
  }

  async createException(
    input: {
      matterId: string;
      category: string;
      severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      title: string;
      detail: string;
      ownerUserId: string;
      dueAt: string;
    },
    context: Readonly<OrganisationAccessContext>,
  ) {
    const rows = await this.rls.run(
      {
        userId: context.userId,
        organisationId: context.organisationId,
        aal: context.aal,
      },
      (tx) =>
        tx.$queryRaw<
          { id: string }[]
        >`SELECT private.create_lifecycle_exception(${input.matterId}::uuid,${input.category},${input.severity},${input.title},${input.detail},${input.ownerUserId}::uuid,${input.dueAt}::timestamptz) AS id`,
    );
    return { id: rows[0]?.id };
  }

  async resolveException(
    id: string,
    resolution: string,
    context: Readonly<OrganisationAccessContext>,
  ) {
    await this.rls.run(
      {
        userId: context.userId,
        organisationId: context.organisationId,
        aal: context.aal,
      },
      (tx) =>
        tx.$executeRaw`SELECT private.resolve_lifecycle_exception(${id}::uuid,${resolution})`,
    );
    return { resolved: true };
  }
}
