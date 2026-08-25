import { Injectable } from '@nestjs/common';

import type { OrganisationAccessContext } from '../auth/request-security-context';
import { RlsTransactionService } from '../database/rls-transaction.service';
import { RoleScope } from '../generated/prisma/enums';

export interface AssignableInvitationRoleView {
  key: string;
  name: string;
  description: string | null;
  scope: RoleScope;
  isSystem: boolean;
}

export interface AssignableInvitationRoleList {
  items: AssignableInvitationRoleView[];
  total: number;
}

@Injectable()
export class InvitationRolesService {
  constructor(private readonly rls: RlsTransactionService) {}

  async findAll(
    context: Readonly<OrganisationAccessContext>,
  ): Promise<AssignableInvitationRoleList> {
    const items = await this.rls.run(
      {
        userId: context.userId,
        organisationId: context.organisationId,
        aal: context.aal,
      },
      (transaction) =>
        transaction.role.findMany({
          where: {
            organisationId: context.organisationId,
            scope: {
              in: [
                RoleScope.ORGANISATION,
                RoleScope.DEPARTMENT,
                RoleScope.TEAM,
              ],
            },
            isAssignable: true,
            deletedAt: null,
            key: { not: 'organisation_owner' },
          },
          select: {
            key: true,
            name: true,
            description: true,
            scope: true,
            isSystem: true,
          },
          orderBy: [{ scope: 'asc' }, { name: 'asc' }, { key: 'asc' }],
        }),
    );

    return {
      items,
      total: items.length,
    };
  }
}
