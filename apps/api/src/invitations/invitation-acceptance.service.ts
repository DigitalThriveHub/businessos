import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type { JWTPayload } from 'jose';

import {
  resolveAssuranceLevel,
  verifyUserJwtPayload,
} from '../auth/verified-jwt-payload';
import { RlsTransactionService } from '../database/rls-transaction.service';
import { InvitationTokenService } from './invitation-token.service';

type InvitationAcceptanceDatabaseRow = {
  invitation_id: string;
  organisation_id: string;
  organisation_name: string;
  organisation_slug: string;
  membership_id: string;
  invitation_status: string;
  role_keys: unknown;
  job_title: string | null;
};

export interface AcceptedOrganisationInvitation {
  invitationId: string;
  organisationId: string;
  organisationName: string;
  organisationSlug: string;
  membershipId: string;
  status: 'ACCEPTED';
  roleKeys: string[];
  jobTitle: string | null;
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function findPostgresErrorCode(
  error: unknown,
  depth = 0,
): string | undefined {
  if (!isRecord(error) || depth > 6) {
    return undefined;
  }

  for (const key of [
    'originalCode',
    'sqlState',
    'sqlstate',
  ]) {
    const value = error[key];

    if (
      typeof value === 'string' &&
      /^[0-9A-Z]{5}$/.test(value)
    ) {
      return value;
    }
  }

  for (const key of [
    'cause',
    'meta',
    'driverAdapterError',
    'originalError',
    'error',
  ]) {
    const nestedCode = findPostgresErrorCode(
      error[key],
      depth + 1,
    );

    if (nestedCode) {
      return nestedCode;
    }
  }

  const directCode = error.code;

  return (
    typeof directCode === 'string' &&
    /^[0-9A-Z]{5}$/.test(directCode)
  )
    ? directCode
    : undefined;
}

function isStringArray(
  value: unknown,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        typeof item === 'string' &&
        item.length > 0,
    )
  );
}

function parseAcceptanceResult(
  row: InvitationAcceptanceDatabaseRow | undefined,
): AcceptedOrganisationInvitation | null {
  if (
    !row ||
    typeof row.invitation_id !== 'string' ||
    typeof row.organisation_id !== 'string' ||
    typeof row.organisation_name !== 'string' ||
    typeof row.organisation_slug !== 'string' ||
    typeof row.membership_id !== 'string' ||
    row.invitation_status !== 'ACCEPTED' ||
    !isStringArray(row.role_keys) ||
    !(
      row.job_title === null ||
      typeof row.job_title === 'string'
    )
  ) {
    return null;
  }

  return {
    invitationId: row.invitation_id,
    organisationId: row.organisation_id,
    organisationName: row.organisation_name,
    organisationSlug: row.organisation_slug,
    membershipId: row.membership_id,
    status: 'ACCEPTED',
    roleKeys: [...row.role_keys].sort(),
    jobTitle: row.job_title,
  };
}

@Injectable()
export class InvitationAcceptanceService {
  private readonly logger = new Logger(
    InvitationAcceptanceService.name,
  );

  constructor(
    private readonly rls: RlsTransactionService,
    private readonly tokens: InvitationTokenService,
  ) {}

  async accept(
    tokenUser: JWTPayload | undefined,
    rawToken: string,
  ): Promise<AcceptedOrganisationInvitation> {
    const verifiedUser =
      verifyUserJwtPayload(tokenUser);

    const userId = verifiedUser.sub;
    const aal =
      resolveAssuranceLevel(verifiedUser);
    const tokenHash =
      this.tokens.hashToken(rawToken);

    try {
      const rows = await this.rls.run(
        {
          userId,
          aal,
        },
        (transaction) =>
          transaction.$queryRaw<
            InvitationAcceptanceDatabaseRow[]
          >`
            SELECT *
            FROM private.accept_organisation_invitation(
              ${tokenHash}
            )
          `,
      );

      const result = parseAcceptanceResult(
        rows.length === 1 ? rows[0] : undefined,
      );

      if (!result) {
        this.logger.error(
          'Invitation acceptance returned an invalid database response',
        );

        throw new InternalServerErrorException(
          'The invitation service returned an invalid response',
        );
      }

      return result;
    } catch (error: unknown) {
      if (
        error instanceof
        InternalServerErrorException
      ) {
        throw error;
      }

      const databaseCode =
        findPostgresErrorCode(error);

      if (databaseCode === '22023') {
        throw new BadRequestException(
          'The invitation link is invalid or has expired.',
        );
      }

      if (databaseCode === '42501') {
        throw new ForbiddenException(
          'This invitation cannot be accepted by the signed-in account.',
        );
      }

      if (
        databaseCode === '55000' ||
        databaseCode === '23505' ||
        databaseCode === '23P01'
      ) {
        throw new ConflictException(
          'This invitation is no longer available.',
        );
      }

      this.logger.error(
        [
          'Invitation acceptance database operation failed',
          `sqlState=${databaseCode ?? 'unknown'}`,
          `errorType=${
            error instanceof Error
              ? error.name
              : typeof error
          }`,
        ].join('; '),
      );

      throw new InternalServerErrorException(
        'The invitation could not be accepted.',
      );
    }
  }
}