import { CommunicationDeliveryWorkerService } from './communication-delivery-worker.service';

const JOB = {
  messageId: '11111111-1111-4111-8111-111111111111',
  organisationId: '22222222-2222-4222-8222-222222222222',
  channel: 'EMAIL',
  connectionId: null,
  provider: 'RESEND',
  secretReference: null,
  mailboxAddress: null,
  phoneNumber: null,
  recipientAddresses: ['client@example.test'],
  subject: 'Case update',
  bodyText: 'A secure case update is available.',
  idempotencyKey: 'staff-message/test-001',
  attempt: 1,
  maxAttempts: 5,
};

describe('CommunicationDeliveryWorkerService', () => {
  const config = {
    enabled: true,
    pollIntervalMs: 5_000,
    leaseSeconds: 120,
    workerIdPrefix: 'test-worker',
  };

  it('materialises, leases and completes one accepted email', async () => {
    const database = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ materialised: 1 }])
        .mockResolvedValueOnce([JOB])
        .mockResolvedValueOnce([{ messageStatus: 'SENT' }]),
    };
    const providers = {
      send: jest.fn().mockResolvedValue({
        provider: 'resend',
        messageId: 'provider-message-1',
      }),
    };
    const worker = new CommunicationDeliveryWorkerService(
      database as never,
      config as never,
      providers as never,
    );

    await expect(worker.runOnce()).resolves.toBe(true);
    expect(providers.send).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: JOB.messageId }),
    );
    expect(database.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it('records provider failure for bounded retry handling', async () => {
    const database = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ materialised: 0 }])
        .mockResolvedValueOnce([JOB])
        .mockResolvedValueOnce([{ messageStatus: 'QUEUED' }]),
    };
    const worker = new CommunicationDeliveryWorkerService(
      database as never,
      config as never,
      {
        send: jest.fn().mockRejectedValue(new Error('provider unavailable')),
      } as never,
    );

    await expect(worker.runOnce()).resolves.toBe(true);
    expect(database.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it('does not touch the queue when delivery is disabled', async () => {
    const database = { $queryRaw: jest.fn() };
    const worker = new CommunicationDeliveryWorkerService(
      database as never,
      { ...config, enabled: false } as never,
      { send: jest.fn() } as never,
    );

    await expect(worker.runOnce()).resolves.toBe(false);
    expect(database.$queryRaw).not.toHaveBeenCalled();
  });
});
