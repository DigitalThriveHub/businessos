import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import {
  verifyUserJwtPayload,
  type VerifiedUserJwtPayload,
} from '../../verified-jwt-payload';

const MAX_AUTHORIZATION_HEADER_LENGTH = 16_384;

const BEARER_TOKEN_PATTERN =
  /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i;

export interface AuthenticatedRequest extends Request {
  user: VerifiedUserJwtPayload;
}

function requireConfiguration(config: ConfigService, key: string): string {
  const value = config.getOrThrow<string>(key).trim();

  if (!value) {
    throw new Error(`${key} must not be empty`);
  }

  return value;
}

function validateServiceUrl(value: string, key: string): URL {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} must be a valid URL`);
  }

  if (url.username || url.password) {
    throw new Error(`${key} must not contain credentials`);
  }

  const isLocalDevelopment =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '::1';

  if (
    url.protocol !== 'https:' &&
    !(isLocalDevelopment && url.protocol === 'http:')
  ) {
    throw new Error(`${key} must use HTTPS outside local development`);
  }

  return url;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  private readonly issuer: string;
  private readonly audience: string;

  constructor(config: ConfigService) {
    const supabaseUrlValue = requireConfiguration(config, 'SUPABASE_URL');

    this.issuer = requireConfiguration(config, 'SUPABASE_JWT_ISSUER');

    this.audience = requireConfiguration(config, 'SUPABASE_JWT_AUDIENCE');

    const supabaseUrl = validateServiceUrl(supabaseUrlValue, 'SUPABASE_URL');

    validateServiceUrl(this.issuer, 'SUPABASE_JWT_ISSUER');

    const jwksUrl = new URL('/auth/v1/.well-known/jwks.json', supabaseUrl);

    this.jwks = createRemoteJWKSet(jwksUrl);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const authorization = request.headers.authorization;

    if (
      typeof authorization !== 'string' ||
      authorization.length > MAX_AUTHORIZATION_HEADER_LENGTH
    ) {
      throw new UnauthorizedException('Authentication is required');
    }

    const match = BEARER_TOKEN_PATTERN.exec(authorization);

    if (!match) {
      throw new UnauthorizedException('Authentication is required');
    }

    const token = match[1];

    try {
      const { payload, protectedHeader } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ['ES256', 'RS256'],
        requiredClaims: [
          'exp',
          'iat',
          'sub',
          'role',
          'session_id',
          'is_anonymous',
        ],
        clockTolerance: 5,
      });

      if (
        typeof protectedHeader.kid !== 'string' ||
        protectedHeader.kid.length === 0
      ) {
        throw new UnauthorizedException('Authentication is required');
      }

      request.user = Object.freeze(verifyUserJwtPayload(payload));

      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
