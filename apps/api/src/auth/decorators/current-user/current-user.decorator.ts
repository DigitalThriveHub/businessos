import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { JWTPayload } from 'jose';
import type { AuthenticatedRequest } from '../../guards/jwt-auth/jwt-auth.guard';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): JWTPayload => {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();

    return request.user;
  },
);