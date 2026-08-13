import {
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
} from 'jose';
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from './jwt-auth.guard';

jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn(),
}));

const USER_ID =
  '11111111-1111-4111-8111-111111111111';

const SESSION_ID =
  '22222222-2222-4222-8222-222222222222';

const SUPABASE_URL =
  'https://example.supabase.co';

const ISSUER =
  'https://example.supabase.co/auth/v1';

const AUDIENCE = 'authenticated';

const createRemoteJwkSetMock =
  createRemoteJWKSet as jest.MockedFunction<
    typeof createRemoteJWKSet
  >;

const jwtVerifyMock =
  jwtVerify as jest.MockedFunction<typeof jwtVerify>;

function createConfigService(
  overrides: Partial<Record<string, string>> = {},
): ConfigService {
  const values: Record<string, string> = {
    SUPABASE_URL,
    SUPABASE_JWT_ISSUER: ISSUER,
    SUPABASE_JWT_AUDIENCE: AUDIENCE,
    ...overrides,
  };

  return {
    getOrThrow: jest.fn((key: string) => {
      const value = values[key];

      if (value === undefined) {
        throw new Error(
          `Missing test configuration: ${key}`,
        );
      }

      return value;
    }),
  } as unknown as ConfigService;
}

function createExecutionContext(
  authorization?: string,
): {
  context: ExecutionContext;
  request: AuthenticatedRequest;
} {
  const request = {
    headers: authorization
      ? {
          authorization,
        }
      : {},
  } as unknown as AuthenticatedRequest;

  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;

  return {
    context,
    request,
  };
}

function createValidPayload(
  overrides: Partial<JWTPayload> = {},
): JWTPayload {
  const now = Math.floor(Date.now() / 1_000);

  return {
    iss: ISSUER,
    aud: AUDIENCE,
    exp: now + 3_600,
    iat: now,
    sub: USER_ID,
    role: 'authenticated',
    aal: 'aal1',
    session_id: SESSION_ID,
    is_anonymous: false,
    ...overrides,
  };
}

function mockSuccessfulVerification(
  payload: JWTPayload,
  kid = 'test-signing-key',
): void {
  jwtVerifyMock.mockResolvedValue({
    payload,
    protectedHeader: {
      alg: 'ES256',
      kid,
    },
  } as Awaited<ReturnType<typeof jwtVerify>>);
}

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  beforeEach(() => {
    jest.resetAllMocks();

    createRemoteJwkSetMock.mockReturnValue(
      jest.fn() as unknown as ReturnType<
        typeof createRemoteJWKSet
      >,
    );

    guard = new JwtAuthGuard(createConfigService());
  });

  it('configures the Supabase asymmetric JWKS endpoint', () => {
    expect(createRemoteJwkSetMock).toHaveBeenCalledTimes(1);

    const [url] = createRemoteJwkSetMock.mock.calls[0];

    expect(url.toString()).toBe(
      `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
    );
  });

  it('accepts a valid authenticated Supabase user token', async () => {
    mockSuccessfulVerification(createValidPayload());

    const { context, request } =
      createExecutionContext('Bearer valid.jwt.token');

    await expect(
      guard.canActivate(context),
    ).resolves.toBe(true);

    expect(jwtVerifyMock).toHaveBeenCalledWith(
      'valid.jwt.token',
      expect.any(Function),
      expect.objectContaining({
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['ES256', 'RS256'],
        requiredClaims: expect.arrayContaining([
          'exp',
          'iat',
          'sub',
          'role',
          'session_id',
          'is_anonymous',
        ]),
        clockTolerance: 5,
      }),
    );

    expect(request.user).toEqual(
      expect.objectContaining({
        sub: USER_ID,
        role: 'authenticated',
        aal: 'aal1',
        session_id: SESSION_ID,
        is_anonymous: false,
      }),
    );

    expect(Object.isFrozen(request.user)).toBe(true);
  });

  it('preserves an AAL2 authenticated session', async () => {
    mockSuccessfulVerification(
      createValidPayload({
        aal: 'aal2',
      }),
    );

    const { context, request } =
      createExecutionContext('Bearer valid.jwt.token');

    await expect(
      guard.canActivate(context),
    ).resolves.toBe(true);

    expect(request.user.aal).toBe('aal2');
  });

  it('treats a missing AAL claim as AAL1', async () => {
    const payload = createValidPayload();

    delete payload.aal;

    mockSuccessfulVerification(payload);

    const { context, request } =
      createExecutionContext('Bearer valid.jwt.token');

    await expect(
      guard.canActivate(context),
    ).resolves.toBe(true);

    expect(request.user.aal).toBe('aal1');
  });

  it('rejects a request without an authorization header', async () => {
    const { context } = createExecutionContext();

    await expect(
      guard.canActivate(context),
    ).rejects.toThrow(UnauthorizedException);

    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed authorization scheme', async () => {
    const { context } =
      createExecutionContext('Basic credentials');

    await expect(
      guard.canActivate(context),
    ).rejects.toThrow(UnauthorizedException);

    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it('rejects an oversized authorization header', async () => {
    const { context } = createExecutionContext(
      `Bearer ${'a'.repeat(16_384)}`,
    );

    await expect(
      guard.canActivate(context),
    ).rejects.toThrow(UnauthorizedException);

    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it('rejects tokens that fail cryptographic verification', async () => {
    jwtVerifyMock.mockRejectedValue(
      new Error('Signature verification failed'),
    );

    const { context } = createExecutionContext(
      'Bearer invalid.jwt.token',
    );

    await expect(
      guard.canActivate(context),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects service-role tokens', async () => {
    mockSuccessfulVerification(
      createValidPayload({
        role: 'service_role',
      }),
    );

    const { context, request } =
      createExecutionContext('Bearer service.jwt.token');

    await expect(
      guard.canActivate(context),
    ).rejects.toThrow(UnauthorizedException);

    expect(request.user).toBeUndefined();
  });

  it('rejects anonymous-user tokens', async () => {
    mockSuccessfulVerification(
      createValidPayload({
        is_anonymous: true,
      }),
    );

    const { context, request } =
      createExecutionContext('Bearer anonymous.jwt.token');

    await expect(
      guard.canActivate(context),
    ).rejects.toThrow(UnauthorizedException);

    expect(request.user).toBeUndefined();
  });

  it('rejects tokens with an invalid user identifier', async () => {
    mockSuccessfulVerification(
      createValidPayload({
        sub: 'not-a-uuid',
      }),
    );

    const { context } = createExecutionContext(
      'Bearer invalid-user.jwt.token',
    );

    await expect(
      guard.canActivate(context),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects tokens with an invalid session identifier', async () => {
    mockSuccessfulVerification(
      createValidPayload({
        session_id: 'not-a-uuid',
      }),
    );

    const { context } = createExecutionContext(
      'Bearer invalid-session.jwt.token',
    );

    await expect(
      guard.canActivate(context),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects tokens with an unsupported assurance level', async () => {
    mockSuccessfulVerification(
      createValidPayload({
        aal: 'aal3',
      }),
    );

    const { context } = createExecutionContext(
      'Bearer invalid-aal.jwt.token',
    );

    await expect(
      guard.canActivate(context),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects verified tokens without a signing-key identifier', async () => {
    mockSuccessfulVerification(
      createValidPayload(),
      '',
    );

    const { context } = createExecutionContext(
      'Bearer missing-kid.jwt.token',
    );

    await expect(
      guard.canActivate(context),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects insecure remote Supabase URLs at startup', () => {
    expect(
      () =>
        new JwtAuthGuard(
          createConfigService({
            SUPABASE_URL:
              'http://example.supabase.co',
          }),
        ),
    ).toThrow(
      'SUPABASE_URL must use HTTPS outside local development',
    );
  });

  it('rejects Supabase URLs containing credentials', () => {
    expect(
      () =>
        new JwtAuthGuard(
          createConfigService({
            SUPABASE_URL:
              'https://username:password@example.supabase.co',
          }),
        ),
    ).toThrow(
      'SUPABASE_URL must not contain credentials',
    );
  });
});