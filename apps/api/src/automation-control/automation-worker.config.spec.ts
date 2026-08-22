import { AutomationWorkerConfig } from './automation-worker.config';

describe('AutomationWorkerConfig', () => {
  it('enables a bounded worker by default', () => {
    const config = new AutomationWorkerConfig({});
    expect(config.enabled).toBe(true);
    expect(config.pollIntervalMs).toBe(5_000);
    expect(config.batchSize).toBe(50);
  });

  it('accepts explicit safe worker settings', () => {
    const config = new AutomationWorkerConfig({
      AUTOMATION_WORKER_ENABLED: 'false',
      AUTOMATION_WORKER_POLL_INTERVAL_MS: '10000',
      AUTOMATION_WORKER_BATCH_SIZE: '25',
    });
    expect(config.enabled).toBe(false);
    expect(config.pollIntervalMs).toBe(10_000);
    expect(config.batchSize).toBe(25);
  });

  it('rejects unbounded cycle sizes', () => {
    expect(
      () =>
        new AutomationWorkerConfig({
          AUTOMATION_WORKER_BATCH_SIZE: '101',
        }),
    ).toThrow('AUTOMATION_WORKER_BATCH_SIZE');
  });
});
