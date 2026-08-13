import type { JWTPayload } from 'jose';

export interface EnquiryRequestContext {
  userId: string;
  organisationId: string;
  aal: 'AAL1' | 'AAL2';
}

export function enquiryContextFromJwt(
  user: JWTPayload | undefined,
  organisationId: string,
): EnquiryRequestContext {
  if (!user?.sub) {
    throw new Error('Authenticated user context is missing');
  }

  const aal = user.aal === 'aal2' || user.aal === 'AAL2' ? 'AAL2' : 'AAL1';

  return {
    userId: user.sub,
    organisationId,
    aal,
  };
}
