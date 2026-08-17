import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type { JWTPayload } from 'jose';
import { RlsTransactionService } from '../database/rls-transaction.service';
import {
  MembershipStatus,
  OrganisationStatus,
  UserProfileStatus,
} from '../generated/prisma/enums';
import { UpdateCurrentUserProfileDto } from './dto/update-current-user-profile.dto';
import {
  resolveAssuranceLevel,
  verifyUserJwtPayload,
} from './verified-jwt-payload';

export interface CurrentUserOrganisation {
  organisationId: string;
  membershipId: string;
  organisationName: string;
  organisationSlug: string;
  organisationStatus: OrganisationStatus;
  jobTitle: string | null;
  roles: string[];
  permissions: string[];
}

export interface UpdatedCurrentUserProfile {
  id: string;
  email: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  locale: string;
  timezone: string;
  status: UserProfileStatus;
  updatedAt: string;
}

type UpdateProfileDatabaseRow = {
  profile: unknown;
};

function optionalString(
  value: unknown,
): string | undefined {
  return typeof value === 'string'
    ? value
    : undefined;
}

function isObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isNullableString(
  value: unknown,
): value is string | null {
  return value === null || typeof value === 'string';
}

function parseUpdatedProfile(
  value: unknown,
): UpdatedCurrentUserProfile | null {
  let candidate = value;

  /*
   * PostgreSQL adapters may return JSONB as an object or
   * serialised JSON. The SQL query currently requests text
   * explicitly, but supporting both representations keeps this
   * boundary resilient to future driver changes.
   */
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate) as unknown;
    } catch {
      return null;
    }
  }

  if (!isObject(candidate)) {
    return null;
  }

  const updatedAt =
    candidate.updatedAt instanceof Date
      ? candidate.updatedAt.toISOString()
      : candidate.updatedAt;

  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.email !== 'string' ||
    !isNullableString(candidate.displayName) ||
    !isNullableString(candidate.firstName) ||
    !isNullableString(candidate.lastName) ||
    typeof candidate.locale !== 'string' ||
    typeof candidate.timezone !== 'string' ||
    candidate.status !== UserProfileStatus.ACTIVE ||
    typeof updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: candidate.id,
    email: candidate.email,
    displayName: candidate.displayName,
    firstName: candidate.firstName,
    lastName: candidate.lastName,
    locale: candidate.locale,
    timezone: candidate.timezone,
    status: UserProfileStatus.ACTIVE,
    updatedAt,
  };
}

function findPostgresErrorCode(
  error: unknown,
  depth = 0,
): string | undefined {
  if (!isObject(error) || depth > 6) {
    return undefined;
  }

  /*
   * Prefer nested PostgreSQL SQLSTATE values over Prisma adapter
   * codes such as P2039.
   */
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

function buildProfilePatch(
  dto: UpdateCurrentUserProfileDto,
): Record<string, string | null> {
  const patch: Record<string, string | null> = {};

  if (dto.displayName !== undefined) {
    patch.displayName = dto.displayName;
  }

  if (dto.firstName !== undefined) {
    patch.firstName = dto.firstName;
  }

  if (dto.lastName !== undefined) {
    patch.lastName = dto.lastName;
  }

  if (dto.locale !== undefined) {
    patch.locale = dto.locale;
  }

  if (dto.timezone !== undefined) {
    patch.timezone = dto.timezone;
  }

  return patch;
}

function describeRuntimeType(
  value: unknown,
): string {
  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return 'array';
  }

  if (value instanceof Date) {
    return 'Date';
  }

  return typeof value;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(
    AuthService.name,
  );

  constructor(
    private readonly rls: RlsTransactionService,
  ) {}

  async getCurrentUser(
    tokenUser: JWTPayload | undefined,
  ) {
    const verifiedUser =
      verifyUserJwtPayload(tokenUser);

    const userId = verifiedUser.sub;
    const aal =
      resolveAssuranceLevel(verifiedUser);

    const now = new Date();

    const profile = await this.rls.run(
      {
        userId,
        aal,
      },
      (transaction) =>
        transaction.userProfile.findUnique({
          where: {
            id: userId,
          },
          select: {
            id: true,
            email: true,
            displayName: true,
            firstName: true,
            lastName: true,
            status: true,
            deletedAt: true,
            organisationMemberships: {
              where: {
                status: MembershipStatus.ACTIVE,
                deletedAt: null,
                organisation: {
                  status: {
                    in: [
                      OrganisationStatus.PROVISIONING,
                      OrganisationStatus.ACTIVE,
                    ],
                  },
                  deletedAt: null,
                },
              },
              select: {
                id: true,
                organisationId: true,
                jobTitle: true,
                organisation: {
                  select: {
                    id: true,
                    name: true,
                    slug: true,
                    status: true,
                  },
                },
              },
            },
          },
        }),
    );

    if (!profile) {
      return {
        id: userId,
        email: optionalString(
          verifiedUser.email,
        ),
        authenticated: true,
        onboardingRequired: true,
        organisations:
          [] as CurrentUserOrganisation[],
      };
    }

    if (
      profile.status !==
        UserProfileStatus.ACTIVE ||
      profile.deletedAt !== null
    ) {
      throw new ForbiddenException(
        'Account access is unavailable',
      );
    }

    const organisations:
      CurrentUserOrganisation[] = [];

    for (
      const membership of
      profile.organisationMemberships
    ) {
      const assignments = await this.rls.run(
        {
          userId,
          organisationId:
            membership.organisationId,
          aal,
        },
        (transaction) =>
          transaction.roleAssignment.findMany({
            where: {
              userProfileId: userId,
              organisationId:
                membership.organisationId,
              organisationMembershipId:
                membership.id,
              revokedAt: null,
              deletedAt: null,
              validFrom: {
                lte: now,
              },
              OR: [
                {
                  validUntil: null,
                },
                {
                  validUntil: {
                    gt: now,
                  },
                },
              ],
              role: {
                organisationId:
                  membership.organisationId,
                deletedAt: null,
              },
            },
            select: {
              role: {
                select: {
                  key: true,
                  permissions: {
                    where: {
                      permission: {
                        isActive: true,
                        deletedAt: null,
                      },
                    },
                    select: {
                      permission: {
                        select: {
                          key: true,
                          requiresMfa: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          }),
      );

      const roles = [
        ...new Set(
          assignments.map(
            (assignment) =>
              assignment.role.key,
          ),
        ),
      ].sort();

      const permissions = [
        ...new Set(
          assignments.flatMap(
            (assignment) =>
              assignment.role.permissions
                .filter(
                  ({ permission }) =>
                    !permission.requiresMfa ||
                    aal === 'AAL2',
                )
                .map(
                  ({ permission }) =>
                    permission.key,
                ),
          ),
        ),
      ].sort();

      organisations.push({
        organisationId:
          membership.organisationId,
        membershipId: membership.id,
        organisationName:
          membership.organisation.name,
        organisationSlug:
          membership.organisation.slug,
        organisationStatus:
          membership.organisation.status,
        jobTitle: membership.jobTitle,
        roles,
        permissions,
      });
    }

    return {
      id: profile.id,
      email: profile.email,
      displayName: profile.displayName,
      firstName: profile.firstName,
      lastName: profile.lastName,
      status: profile.status,
      authenticated: true,
      onboardingRequired: false,
      organisations,
    };
  }

  async updateCurrentUserProfile(
    tokenUser: JWTPayload | undefined,
    dto: UpdateCurrentUserProfileDto,
  ): Promise<UpdatedCurrentUserProfile> {
    const verifiedUser =
      verifyUserJwtPayload(tokenUser);

    const userId = verifiedUser.sub;
    const aal =
      resolveAssuranceLevel(verifiedUser);

    const patch = buildProfilePatch(dto);

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException(
        'At least one profile field must be provided',
      );
    }

    const serialisedPatch =
      JSON.stringify(patch);

    try {
      const rows = await this.rls.run(
        {
          userId,
          aal,
        },
        (transaction) =>
          transaction.$queryRaw<
            UpdateProfileDatabaseRow[]
          >`
            SELECT (
              private.update_own_profile(
                ${serialisedPatch}::jsonb
              )
            )::text AS profile
          `,
      );

      const rawProfile = rows[0]?.profile;

      const profile =
        parseUpdatedProfile(rawProfile);

      if (!profile) {
        this.logger.error(
          [
            'Profile update response validation failed',
            `profileType=${describeRuntimeType(
              rawProfile,
            )}`,
            `rowKeys=${
              isObject(rows[0])
                ? Object.keys(rows[0])
                    .sort()
                    .join(',')
                : 'none'
            }`,
          ].join('; '),
        );

        throw new InternalServerErrorException(
          'The account service returned an invalid response',
        );
      }

      return profile;
    } catch (error) {
      /*
       * Response-validation failures are logged immediately above.
       * Do not expose database or adapter details to the caller.
       */
      if (
        error instanceof
        InternalServerErrorException
      ) {
        throw error;
      }

      const databaseCode =
        findPostgresErrorCode(error);

      if (databaseCode === '42501') {
        throw new ForbiddenException(
          'Account profile is unavailable',
        );
      }

      if (
        databaseCode === '22001' ||
        databaseCode === '22023'
      ) {
        throw new BadRequestException(
          'The profile update is invalid',
        );
      }

      this.logger.error(
        [
          'Profile update database operation failed',
          `sqlState=${databaseCode ?? 'unknown'}`,
          `errorType=${
            error instanceof Error
              ? error.name
              : typeof error
          }`,
          `message=${
            error instanceof Error
              ? error.message
              : 'Unknown error'
          }`,
        ].join('; '),
        error instanceof Error
          ? error.stack
          : undefined,
      );

      throw new InternalServerErrorException(
        'The account service could not update the profile',
      );
    }
  }
}