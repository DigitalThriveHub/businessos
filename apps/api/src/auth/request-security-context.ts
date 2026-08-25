import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import {
  isUuid,
  type AuthenticationAssuranceLevel,
  type VerifiedUserJwtPayload,
} from './verified-jwt-payload';

export interface OrganisationAccessContext {
  readonly userId: string;
  readonly organisationId: string;
  readonly membershipId: string;
  readonly sessionId: string;
  readonly aal: AuthenticationAssuranceLevel;
}

export interface OrganisationScopedRequest extends Request {
  user?: VerifiedUserJwtPayload;
  organisationAccess?: Readonly<OrganisationAccessContext>;
}

function readOrganisationId(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  return (value as Record<string, unknown>).organisationId;
}

export function resolveRequestOrganisationId(request: Request): string {
  const candidates = [
    readOrganisationId(request.body),
    readOrganisationId(request.query),
    readOrganisationId(request.params),
  ].filter((value) => value !== undefined);

  if (candidates.length === 0) {
    throw new BadRequestException(
      'A valid organisation identifier is required',
    );
  }

  const organisationIds = candidates.map((value) => {
    if (!isUuid(value)) {
      throw new BadRequestException(
        'A valid organisation identifier is required',
      );
    }

    return value;
  });

  const uniqueOrganisationIds = new Set(organisationIds);

  if (uniqueOrganisationIds.size !== 1) {
    throw new BadRequestException(
      'Conflicting organisation identifiers were supplied',
    );
  }

  return organisationIds[0];
}

export function assignOrganisationAccessContext(
  request: OrganisationScopedRequest,
  context: OrganisationAccessContext,
): void {
  request.organisationAccess = Object.freeze({
    ...context,
  });
}

export function requireOrganisationAccessContext(
  request: OrganisationScopedRequest,
): Readonly<OrganisationAccessContext> {
  if (!request.organisationAccess) {
    throw new ForbiddenException('Organisation access could not be verified');
  }

  return request.organisationAccess;
}
