import { BadRequestException } from '@nestjs/common';

import { PortalInvitationTokenService } from './portal-invitation-token.service';

describe('PortalInvitationTokenService', () => {
  const secret = 'portal-secret-that-is-long-enough-and-separated';
  const service = new PortalInvitationTokenService({
    get: jest.fn().mockReturnValue(secret),
  } as never);

  it('issues opaque tokens while retaining only a deterministic keyed hash', () => {
    const first = service.issue();
    const second = service.issue();

    expect(first.token).toMatch(/^bop_v1_[A-Za-z0-9_-]{43}$/);
    expect(first.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(service.hashToken(first.token)).toBe(first.tokenHash);
    expect(second.token).not.toBe(first.token);
    expect(second.tokenHash).not.toBe(first.tokenHash);
  });

  it('rejects malformed invitation material before hashing', () => {
    expect(() => service.hashToken('not-a-token')).toThrow(BadRequestException);
  });
});
