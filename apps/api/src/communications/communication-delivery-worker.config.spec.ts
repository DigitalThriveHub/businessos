import { CommunicationDeliveryWorkerConfig } from './communication-delivery-worker.config';

describe('CommunicationDeliveryWorkerConfig', () => {
  it('is fail-closed by default', () => {
    expect(new CommunicationDeliveryWorkerConfig({}).enabled).toBe(false);
  });

  it('requires provider configuration before delivery is enabled', () => {
    expect(
      () =>
        new CommunicationDeliveryWorkerConfig({
          COMMUNICATION_DELIVERY_ENABLED: 'true',
        }),
    ).toThrow('RESEND_API_KEY');
  });

  it('accepts bounded worker configuration', () => {
    const config = new CommunicationDeliveryWorkerConfig({
      COMMUNICATION_DELIVERY_ENABLED: 'true',
      COMMUNICATION_DELIVERY_POLL_INTERVAL_MS: '2500',
      COMMUNICATION_DELIVERY_LEASE_SECONDS: '180',
      COMMUNICATION_DELIVERY_WORKER_ID_PREFIX: 'communications-01',
      RESEND_API_KEY: 're_test_key_that_is_long_enough',
      EMAIL_FROM_ADDRESS: 'no-reply@example.test',
    });

    expect(config.enabled).toBe(true);
    expect(config.pollIntervalMs).toBe(2500);
    expect(config.leaseSeconds).toBe(180);
    expect(config.workerIdPrefix).toBe('communications-01');
  });
});
