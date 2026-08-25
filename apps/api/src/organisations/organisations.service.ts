import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';

import type { OrganisationAccessContext } from '../auth/request-security-context';
import { RlsTransactionService } from '../database/rls-transaction.service';
import { UpdateOrganisationDto } from './dto/update-organisation.dto';

export interface OrganisationProfile {
  id: string;
  name: string;
  legalName: string | null;
  slug: string;
  status: string;
  timezone: string;
  locale: string;
  countryCode: string;
  createdAt: string;
  updatedAt: string;
}

const DATABASE_ERROR_CODES = new Set(['22001', '22023', '23505', '42501']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function findDatabaseErrorCode(
  error: unknown,
  depth = 0,
  visited = new Set<object>(),
): string | undefined {
  if (
    depth > 5 ||
    typeof error !== 'object' ||
    error === null ||
    visited.has(error)
  ) {
    return undefined;
  }

  visited.add(error);

  for (const value of Object.values(error as Record<string, unknown>)) {
    if (typeof value === 'string' && DATABASE_ERROR_CODES.has(value)) {
      return value;
    }
  }

  for (const value of Object.values(error as Record<string, unknown>)) {
    const nestedCode = findDatabaseErrorCode(value, depth + 1, visited);

    if (nestedCode) {
      return nestedCode;
    }
  }

  return undefined;
}

function toIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' && !(value instanceof Date)) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseOrganisationProfile(value: unknown): OrganisationProfile {
  if (!isRecord(value)) {
    throw new InternalServerErrorException(
      'The organisation service returned an invalid response',
    );
  }

  const {
    id,
    name,
    legalName,
    slug,
    status,
    timezone,
    locale,
    countryCode,
    createdAt,
    updatedAt,
  } = value;

  const validLegalName = legalName === null || typeof legalName === 'string';

  const createdAtIso = toIsoTimestamp(createdAt);

  const updatedAtIso = toIsoTimestamp(updatedAt);

  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    !validLegalName ||
    typeof slug !== 'string' ||
    typeof status !== 'string' ||
    typeof timezone !== 'string' ||
    typeof locale !== 'string' ||
    typeof countryCode !== 'string' ||
    !createdAtIso ||
    !updatedAtIso
  ) {
    throw new InternalServerErrorException(
      'The organisation service returned an invalid response',
    );
  }

  return {
    id,
    name,
    legalName: typeof legalName === 'string' ? legalName : null,
    slug,
    status,
    timezone,
    locale,
    countryCode,
    createdAt: createdAtIso,
    updatedAt: updatedAtIso,
  };
}

function createUpdatePatch(
  dto: UpdateOrganisationDto,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(dto).filter(([, value]) => value !== undefined),
  );
}

function throwDatabaseError(error: unknown): never {
  if (error instanceof InternalServerErrorException) {
    throw error;
  }

  const databaseCode = findDatabaseErrorCode(error);

  switch (databaseCode) {
    case '22001':
      throw new PayloadTooLargeException(
        'The organisation update is too large',
      );

    case '22023':
      throw new BadRequestException('The organisation details are invalid');

    case '23505':
      throw new ConflictException('The organisation URL is already in use');

    case '42501':
      throw new ForbiddenException('Organisation update is not permitted');

    default:
      throw new InternalServerErrorException(
        'The organisation service is temporarily unavailable',
      );
  }
}

@Injectable()
export class OrganisationsService {
  constructor(private readonly rls: RlsTransactionService) {}

  async findCurrent(
    context: Readonly<OrganisationAccessContext>,
  ): Promise<OrganisationProfile> {
    try {
      const organisation = await this.rls.run(
        {
          userId: context.userId,
          organisationId: context.organisationId,
          aal: context.aal,
        },
        (transaction) =>
          transaction.organisation.findFirst({
            where: {
              id: context.organisationId,
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
          }),
      );

      if (!organisation) {
        throw new NotFoundException('Organisation was not found');
      }

      return parseOrganisationProfile(organisation);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      throwDatabaseError(error);
    }
  }

  async updateCurrent(
    dto: UpdateOrganisationDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<OrganisationProfile> {
    const patch = createUpdatePatch(dto);

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException(
        'At least one organisation field must be supplied',
      );
    }

    const patchJson = JSON.stringify(patch);

    try {
      const rows = await this.rls.run(
        {
          userId: context.userId,
          organisationId: context.organisationId,
          aal: context.aal,
        },
        (transaction) =>
          transaction.$queryRaw<
            Array<{
              organisation: unknown;
            }>
          >`
            SELECT
              private.update_organisation_profile(
                ${context.organisationId}::uuid,
                ${patchJson}::jsonb
              ) AS organisation
          `,
      );

      const organisation = rows[0]?.organisation;

      return parseOrganisationProfile(organisation);
    } catch (error) {
      throwDatabaseError(error);
    }
  }
}
