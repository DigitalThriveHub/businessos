import { createHmac } from 'node:crypto';

import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { IntegrationSigningService } from './integration-signing.service';

describe('IntegrationSigningService', () => {
  const master = 'gate-f-integration-master-secret-with-strong-entropy';
  const connectionId = '11111111-1111-4111-8111-111111111111';
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => {
      if (key === 'INTEGRATION_SIGNING_MASTER_SECRET') return master;
      if (key === 'INTEGRATION_WEBHOOK_TOLERANCE_SECONDS') return 300;
      return fallback;
    }),
  } as unknown as ConfigService;
  const service = new IntegrationSigningService(config);

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1_787_398_400_000);
  });

  afterEach(() => jest.restoreAllMocks());

  it('derives a stable per-connection and per-version secret', () => {
    expect(service.deriveConnectionSecret(connectionId, 1)).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
    expect(service.deriveConnectionSecret(connectionId, 1)).toBe(
      service.deriveConnectionSecret(connectionId, 1),
    );
    expect(service.deriveConnectionSecret(connectionId, 2)).not.toBe(
      service.deriveConnectionSecret(connectionId, 1),
    );
  });

  it('accepts an authentic, fresh webhook signature', () => {
    const timestamp = '1787398400';
    const eventId = 'wordpress/submission/123';
    const rawBody = Buffer.from('{"firstName":"Ada"}', 'utf8');
    const secret = service.deriveConnectionSecret(connectionId, 1);
    const signature = createHmac('sha256', secret)
      .update(timestamp)
      .update('.')
      .update(eventId)
      .update('.')
      .update(rawBody)
      .digest('hex');

    expect(() =>
      service.verifyIntakeSignature({
        connectionId,
        secretVersion: 1,
        eventId,
        timestamp,
        signature: `v1=${signature}`,
        rawBody,
      }),
    ).not.toThrow();
  });

  it('rejects tampered and stale webhook evidence', () => {
    expect(() =>
      service.verifyIntakeSignature({
        connectionId,
        secretVersion: 1,
        eventId: 'event-1',
        timestamp: '1787398400',
        signature: `v1=${'0'.repeat(64)}`,
        rawBody: Buffer.from('{}'),
      }),
    ).toThrow(BadRequestException);

    expect(() =>
      service.verifyIntakeSignature({
        connectionId,
        secretVersion: 1,
        eventId: 'event-1',
        timestamp: '1787397000',
        signature: `v1=${'0'.repeat(64)}`,
        rawBody: Buffer.from('{}'),
      }),
    ).toThrow('outside tolerance');
  });

  it('fails closed when signing material is absent', () => {
    const missing = new IntegrationSigningService({
      get: jest.fn(),
    } as unknown as ConfigService);
    expect(() => missing.deriveConnectionSecret(connectionId, 1)).toThrow(
      ServiceUnavailableException,
    );
  });
});
