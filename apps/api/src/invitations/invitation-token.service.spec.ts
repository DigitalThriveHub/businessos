import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { createHmac } from 'node:crypto';

import { InvitationTokenService } from './invitation-token.service';

const TOKEN_SECRET = 'test-only-secret-with-at-least-32-characters';
const VALID_TOKEN = `boi_v1_${'A'.repeat(43)}`;

describe('InvitationTokenService', () => {
  let service: InvitationTokenService;
  let configGet: jest.Mock;

  beforeEach(async () => {
    configGet = jest.fn((key: string) =>
      key === 'INVITATION_TOKEN_SECRET' ? TOKEN_SECRET : undefined,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvitationTokenService,
        {
          provide: ConfigService,
          useValue: {
            get: configGet,
          },
        },
      ],
    }).compile();

    service = module.get<InvitationTokenService>(InvitationTokenService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('issues a versioned 256-bit token and its deterministic HMAC hash', () => {
    const issued = service.issue();

    expect(issued.token).toMatch(/^boi_v1_[A-Za-z0-9_-]{43}$/);
    expect(issued.tokenHash).toMatch(/^[a-f0-9]{64}$/);

    const expectedHash = createHmac('sha256', TOKEN_SECRET)
      .update(`businessos:organisation-invitation:v1:${issued.token}`, 'utf8')
      .digest('hex');

    expect(issued.tokenHash).toBe(expectedHash);
  });

  it('issues a different token for every invitation', () => {
    const first = service.issue();
    const second = service.issue();

    expect(second.token).not.toBe(first.token);
    expect(second.tokenHash).not.toBe(first.tokenHash);
  });

  it('rejects malformed tokens before reading the secret', () => {
    expect(() => service.hashToken('invalid-token')).toThrow(
      BadRequestException,
    );

    expect(configGet).not.toHaveBeenCalled();
  });

  it('fails closed when the HMAC secret is unavailable', () => {
    configGet.mockReturnValue(undefined);

    expect(() => service.hashToken(VALID_TOKEN)).toThrow(
      ServiceUnavailableException,
    );
  });

  it('validates only the exact supported token format', () => {
    expect(service.isValidFormat(VALID_TOKEN)).toBe(true);
    expect(service.isValidFormat(`boi_v2_${'A'.repeat(43)}`)).toBe(false);
    expect(service.isValidFormat(`boi_v1_${'A'.repeat(42)}`)).toBe(false);
    expect(service.isValidFormat(null)).toBe(false);
  });
});
