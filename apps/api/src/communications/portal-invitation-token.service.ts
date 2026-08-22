import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes } from 'node:crypto';

import type { Environment } from '../config/env.validation';

const TOKEN_PREFIX = 'bop_v1_';
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^bop_v1_[A-Za-z0-9_-]{43}$/;

export interface IssuedPortalInvitationToken {
  token: string;
  tokenHash: string;
}

@Injectable()
export class PortalInvitationTokenService {
  constructor(private readonly config: ConfigService<Environment, true>) {}

  issue(): IssuedPortalInvitationToken {
    const token = `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString('base64url')}`;

    return {
      token,
      tokenHash: this.hashToken(token),
    };
  }

  hashToken(token: string): string {
    if (!TOKEN_PATTERN.test(token)) {
      throw new BadRequestException(
        'The client portal invitation link is invalid or has expired.',
      );
    }

    const secret = this.config.get('PORTAL_INVITATION_TOKEN_SECRET', {
      infer: true,
    });

    if (!secret) {
      throw new ServiceUnavailableException(
        'Client portal invitation processing is temporarily unavailable.',
      );
    }

    return createHmac('sha256', secret)
      .update(`businessos:client-portal-invitation:v1:${token}`, 'utf8')
      .digest('hex');
  }

  isValidFormat(value: unknown): value is string {
    return typeof value === 'string' && TOKEN_PATTERN.test(value);
  }
}
