import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { JWTPayload } from 'jose';
import { PrismaService } from '../../../database/prisma.service';

interface OrganisationRequest extends Request {
  user: JWTPayload;
  body: {
    organisationId?: string;
  };
  query: {
    organisationId?: string;
  };
}

@Injectable()
export class OrganisationAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<OrganisationRequest>();

    const userId = request.user?.sub;
    const organisationId =
      request.body?.organisationId ?? request.query?.organisationId;

    if (!userId || !organisationId) {
      throw new ForbiddenException('Organisation access could not be verified');
    }

    const membership = await this.prisma.organisationMembership.findFirst({
      where: {
        userProfileId: userId,
        organisationId,
        status: 'ACTIVE',
        deletedAt: null,
        organisation: {
          status: 'ACTIVE',
          deletedAt: null,
        },
      },
      select: {
        id: true,
      },
    });

    if (!membership) {
      throw new ForbiddenException(
        'You do not have access to this organisation',
      );
    }

    return true;
  }
}