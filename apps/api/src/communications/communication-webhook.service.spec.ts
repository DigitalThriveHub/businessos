import { BadRequestException } from '@nestjs/common';

import { CommunicationWebhookService } from './communication-webhook.service';

const HEADERS = {
  id: 'event-001',
  timestamp: '1787319127',
  signature: 'v1,test-signature',
};

describe('CommunicationWebhookService', () => {
  it('persists verified delivery evidence without storing the raw payload', async () => {
    const email = {
      verifyResendWebhook: jest.fn().mockReturnValue({
        type: 'email.delivered',
        created_at: '2026-08-21T14:00:00.000Z',
        data: { email_id: 'provider-message-1', to: ['private@example.test'] },
      }),
    };
    const database = {
      $queryRaw: jest.fn().mockResolvedValue([{ recorded: true }]),
    };
    const service = new CommunicationWebhookService(
      email as never,
      database as never,
    );

    await expect(
      service.handleResend(Buffer.from('{"signed":true}'), HEADERS),
    ).resolves.toEqual({ accepted: true });
    expect(database.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('acknowledges signed provider events that do not change delivery state', async () => {
    const database = { $queryRaw: jest.fn() };
    const service = new CommunicationWebhookService(
      {
        verifyResendWebhook: jest.fn().mockReturnValue({
          type: 'email.opened',
          data: { email_id: 'provider-message-1' },
        }),
      } as never,
      database as never,
    );

    await expect(
      service.handleResend(Buffer.from('{}'), HEADERS),
    ).resolves.toEqual({ accepted: true });
    expect(database.$queryRaw).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature without querying the database', async () => {
    const database = { $queryRaw: jest.fn() };
    const service = new CommunicationWebhookService(
      {
        verifyResendWebhook: jest.fn().mockImplementation(() => {
          throw new Error('bad signature');
        }),
      } as never,
      database as never,
    );

    await expect(
      service.handleResend(Buffer.from('{}'), HEADERS),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(database.$queryRaw).not.toHaveBeenCalled();
  });
});
