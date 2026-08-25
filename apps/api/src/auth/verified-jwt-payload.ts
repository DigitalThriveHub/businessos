import { UnauthorizedException } from '@nestjs/common';
import type { JWTPayload } from 'jose';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AuthenticationAssuranceLevel = 'AAL1' | 'AAL2';

export interface VerifiedUserJwtPayload extends JWTPayload {
  sub: string;
  role: 'authenticated';
  aal: 'aal1' | 'aal2';
  session_id: string;
  is_anonymous: false;
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function verifyUserJwtPayload(
  payload: JWTPayload | undefined,
): VerifiedUserJwtPayload {
  if (
    !payload ||
    !isUuid(payload.sub) ||
    payload.role !== 'authenticated' ||
    !isUuid(payload.session_id) ||
    payload.is_anonymous !== false
  ) {
    throw new UnauthorizedException('Authentication is required');
  }

  if (
    payload.aal !== undefined &&
    payload.aal !== 'aal1' &&
    payload.aal !== 'aal2'
  ) {
    throw new UnauthorizedException('Authentication is required');
  }

  return {
    ...payload,
    sub: payload.sub,
    role: 'authenticated',
    aal: payload.aal === 'aal2' ? 'aal2' : 'aal1',
    session_id: payload.session_id,
    is_anonymous: false,
  };
}

export function resolveAssuranceLevel(
  payload: VerifiedUserJwtPayload,
): AuthenticationAssuranceLevel {
  return payload.aal === 'aal2' ? 'AAL2' : 'AAL1';
}
