import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class IntegrationSigningService {
  constructor(private readonly config: ConfigService) {}

  deriveConnectionSecret(connectionId: string, version: number): string {
    const master = this.config.get<string>('INTEGRATION_SIGNING_MASTER_SECRET');
    if (!master) {
      throw new ServiceUnavailableException(
        'The integration signing service is not configured.',
      );
    }

    return createHmac('sha256', master)
      .update(`BusinessOS/integration/v1/${connectionId}/${version}`, 'utf8')
      .digest('base64url');
  }

  verifyIntakeSignature(input: {
    connectionId: string;
    secretVersion: number;
    eventId: string;
    timestamp: string;
    signature: string;
    rawBody: Buffer;
  }): void {
    if (!/^\d{10}$/.test(input.timestamp)) {
      throw new BadRequestException('The webhook timestamp is invalid.');
    }

    const tolerance = this.config.get<number>(
      'INTEGRATION_WEBHOOK_TOLERANCE_SECONDS',
      300,
    );
    const observed = Number(input.timestamp);
    const now = Math.floor(Date.now() / 1_000);
    if (
      !Number.isSafeInteger(observed) ||
      Math.abs(now - observed) > tolerance
    ) {
      throw new BadRequestException(
        'The webhook timestamp is outside tolerance.',
      );
    }

    const supplied = /^v1=([0-9a-f]{64})$/.exec(input.signature)?.[1];
    if (!supplied) {
      throw new BadRequestException('The webhook signature is invalid.');
    }

    const secret = this.deriveConnectionSecret(
      input.connectionId,
      input.secretVersion,
    );
    const expected = createHmac('sha256', secret)
      .update(input.timestamp, 'utf8')
      .update('.', 'utf8')
      .update(input.eventId, 'utf8')
      .update('.', 'utf8')
      .update(input.rawBody)
      .digest();
    const suppliedBytes = Buffer.from(supplied, 'hex');

    if (
      suppliedBytes.length !== expected.length ||
      !timingSafeEqual(suppliedBytes, expected)
    ) {
      throw new BadRequestException('The webhook signature is invalid.');
    }
  }
}
