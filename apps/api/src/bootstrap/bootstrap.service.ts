import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { RlsTransactionService } from '../database/rls-transaction.service';
import { BootstrapOrganisationDto } from './dto/bootstrap-organisation.dto';
import {
  BootstrapActor,
  BootstrapOrganisationResult,
} from './bootstrap.types';

interface DatabaseBootstrapRow {
  organisation_id: string;
  organisation_slug: string;
  membership_id: string;
  owner_role_id: string;
  owner_role_assignment_id: string;
  status: string;
}

@Injectable()
export class BootstrapService {
  constructor(
    private readonly rlsTransaction: RlsTransactionService,
  ) {}

  async bootstrapOrganisation(
    actor: BootstrapActor,
    dto: BootstrapOrganisationDto,
  ): Promise<BootstrapOrganisationResult> {
    const userId = actor.userId.trim();
    const authenticatedEmail = actor.email.trim().toLowerCase();
    const ownerEmail = dto.ownerEmail.trim().toLowerCase();

    if (!userId || !authenticatedEmail) {
      throw new ForbiddenException(
        'A valid authenticated identity is required.',
      );
    }

    if (ownerEmail !== authenticatedEmail) {
      throw new ForbiddenException(
        'Owner email must match the authenticated identity.',
      );
    }

    try {
      const rows = await this.rlsTransaction.run(
        {
          userId,
          aal: 'AAL1',
        },
        async (transaction) =>
          transaction.$queryRaw<DatabaseBootstrapRow[]>(
            Prisma.sql`
              SELECT *
              FROM private.bootstrap_organisation(
                ${dto.name.trim()},
                ${dto.slug.trim()},
                ${this.optionalText(dto.legalName)},
                ${ownerEmail},
                ${this.optionalText(dto.ownerDisplayName)},
                ${this.optionalText(dto.ownerFirstName)},
                ${this.optionalText(dto.ownerLastName)},
                ${this.optionalText(dto.ownerJobTitle)},
                ${dto.timezone?.trim() || 'Europe/London'},
                ${dto.locale?.trim() || 'en-GB'},
                ${dto.countryCode?.trim() || 'GB'}
              )
            `,
          ),
      );

      const result = rows[0];

      if (
        rows.length !== 1 ||
        !result ||
        result.status !== 'ACTIVE'
      ) {
        throw new InternalServerErrorException(
          'Organisation bootstrap returned an invalid result.',
        );
      }

      return {
        organisationId: result.organisation_id,
        organisationSlug: result.organisation_slug,
        membershipId: result.membership_id,
        ownerRoleId: result.owner_role_id,
        ownerRoleAssignmentId:
          result.owner_role_assignment_id,
        status: 'ACTIVE',
      };
    } catch (error: unknown) {
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof ForbiddenException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      const databaseCode = this.getDatabaseCode(error);
      const databaseMessage = this.getDatabaseMessage(error);

      if (
        databaseCode === '23505' ||
        databaseMessage.includes('already belongs') ||
        databaseMessage.includes('already in use')
      ) {
        throw new ConflictException(
          'The organisation cannot be created because the user or slug is already registered.',
        );
      }

      if (
        databaseCode === '42501' ||
        databaseMessage.includes(
          'owner email must match',
        ) ||
        databaseMessage.includes(
          'authenticated user context is required',
        )
      ) {
        throw new ForbiddenException(
          'You are not authorised to bootstrap this organisation.',
        );
      }

      if (
        databaseCode === '23514' ||
        databaseMessage.includes(
          'invalid organisation slug',
        ) ||
        databaseMessage.includes(
          'invalid iso country code',
        ) ||
        databaseMessage.includes(
          'organisation name must',
        )
      ) {
        throw new BadRequestException(
          'The organisation details are invalid.',
        );
      }

      throw new InternalServerErrorException(
        'Organisation bootstrap failed.',
      );
    }
  }

  private optionalText(
    value: string | undefined,
  ): string | null {
    const normalized = value?.trim();

    return normalized ? normalized : null;
  }

  private getDatabaseCode(error: unknown): string {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('meta' in error)
    ) {
      return '';
    }

    const meta = error.meta;

    if (
      typeof meta !== 'object' ||
      meta === null ||
      !('code' in meta)
    ) {
      return '';
    }

    return typeof meta.code === 'string' ? meta.code : '';
  }

  private getDatabaseMessage(error: unknown): string {
    if (!(error instanceof Error)) {
      return '';
    }

    return error.message.toLowerCase();
  }
}