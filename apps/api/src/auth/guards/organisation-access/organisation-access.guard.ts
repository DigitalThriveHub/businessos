import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { JWTPayload } from 'jose';
import { RlsTransactionService } from '../../../database/rls-transaction.service';

type OrganisationRequest = Request & {
  user?: JWTPayload;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveOrganisationId(
  request: OrganisationRequest,
): string | null {
  const body = request.body as
    | { organisationId?: unknown }
    | undefined;

  const query = request.query as
    | { organisationId?: unknown }
    | undefined;

  const candidate =
    body?.organisationId ?? query?.organisationId;

  return typeof candidate === 'string' &&
    UUID_PATTERN.test(candidate)
    ? candidate
    : null;
}

function resolveAal(user: JWTPayload): 'AAL1' | 'AAL2' {
  return user.aal === 'aal2' || user.aal === 'AAL2'
    ? 'AAL2'
    : 'AAL1';
}

@Injectable()
export class OrganisationAccessGuard implements CanActivate {
  constructor(
    private readonly rls: RlsTransactionService,
  ) {}

  async canActivate(
    context: ExecutionContext,
  ): Promise<boolean> {
    const request =
      context.switchToHttp().getRequest<OrganisationRequest>();

    const user = request.user;
    const userId = user?.sub;
    const organisationId = resolveOrganisationId(request);

    if (!user || !userId || !organisationId) {
      throw new ForbiddenException(
        'Organisation access could not be verified',
      );
    }

    const membership = await this.rls.run(
      {
        userId,
        organisationId,
        aal: resolveAal(user),
      },
      (transaction) =>
        transaction.organisationMembership.findFirst({
          where: {
            userProfileId: userId,
            organisationId,
            status: 'ACTIVE',
            deletedAt: null,
            userProfile: {
              status: 'ACTIVE',
              deletedAt: null,
            },
            organisation: {
              status: 'ACTIVE',
              deletedAt: null,
            },
          },
          select: {
            id: true,
          },
        }),
    );

    if (!membership) {
      throw new ForbiddenException(
        'You do not have access to this organisation',
      );
    }

    return true;
  }
}