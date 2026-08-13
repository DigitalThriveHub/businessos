import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  MembershipStatus,
  OrganisationStatus,
  UserProfileStatus,
} from '../../../generated/prisma/enums';
import { RlsTransactionService } from '../../../database/rls-transaction.service';
import {
  assignOrganisationAccessContext,
  resolveRequestOrganisationId,
  type OrganisationScopedRequest,
} from '../../request-security-context';
import {
  resolveAssuranceLevel,
  verifyUserJwtPayload,
} from '../../verified-jwt-payload';

@Injectable()
export class OrganisationAccessGuard
  implements CanActivate
{
  constructor(
    private readonly rls: RlsTransactionService,
  ) {}

  async canActivate(
    context: ExecutionContext,
  ): Promise<boolean> {
    const request =
      context
        .switchToHttp()
        .getRequest<OrganisationScopedRequest>();

    const user = verifyUserJwtPayload(request.user);
    const organisationId =
      resolveRequestOrganisationId(request);
    const aal = resolveAssuranceLevel(user);

    const membership = await this.rls.run(
      {
        userId: user.sub,
        organisationId,
        aal,
      },
      (transaction) =>
        transaction.organisationMembership.findFirst({
          where: {
            userProfileId: user.sub,
            organisationId,
            status: MembershipStatus.ACTIVE,
            deletedAt: null,
            userProfile: {
              status: UserProfileStatus.ACTIVE,
              deletedAt: null,
            },
            organisation: {
              status: OrganisationStatus.ACTIVE,
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

    assignOrganisationAccessContext(request, {
      userId: user.sub,
      organisationId,
      membershipId: membership.id,
      sessionId: user.session_id,
      aal,
    });

    return true;
  }
}