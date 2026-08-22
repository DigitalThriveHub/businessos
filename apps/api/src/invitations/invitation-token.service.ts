import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHmac,
  randomBytes,
} from 'node:crypto';

import type { Environment } from '../config/env.validation';

const TOKEN_PREFIX = 'boi_v1_';
const TOKEN_BYTES = 32;
const TOKEN_PATTERN =
  /^boi_v1_[A-Za-z0-9_-]{43}$/;

export interface IssuedInvitationToken {
  token: string;
  tokenHash: string;
}

@Injectable()
export class InvitationTokenService {
  constructor(
    private readonly config: ConfigService<
      Environment,
      true
    >,
  ) {}

  issue(): IssuedInvitationToken {
    const randomValue = randomBytes(
      TOKEN_BYTES,
    ).toString('base64url');

    const token =
      `${TOKEN_PREFIX}${randomValue}`;

    return {
      token,
      tokenHash: this.hashToken(token),
    };
  }

  hashToken(token: string): string {
    if (!TOKEN_PATTERN.test(token)) {
      throw new BadRequestException(
        'The invitation link is invalid or has expired.',
      );
    }

    const secret = this.config.get(
      'INVITATION_TOKEN_SECRET',
      { infer: true },
    );

    if (!secret) {
      throw new ServiceUnavailableException(
        'Invitation processing is temporarily unavailable.',
      );
    }

    return createHmac('sha256', secret)
      .update(
        `businessos:organisation-invitation:v1:${token}`,
        'utf8',
      )
      .digest('hex');
  }

  isValidFormat(
    token: unknown,
  ): token is string {
    return (
      typeof token === 'string' &&
      TOKEN_PATTERN.test(token)
    );
  }
}