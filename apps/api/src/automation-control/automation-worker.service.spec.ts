import { AutomationWorkerService } from './automation-worker.service';

describe('AutomationWorkerService', () => {
  it('runs one bounded database cycle', async () => {
    const result = {
      atRiskCount: 2,
      breachedCount: 1,
      escalationCount: 1,
      expiredApprovalCount: 0,
    };
    const database = {
      $queryRaw: jest.fn().mockResolvedValue([result]),
    };
    const worker = new AutomationWorkerService(
      database as never,
      {
        enabled: true,
        pollIntervalMs: 5_000,
        batchSize: 25,
      } as never,
    );

    await expect(worker.runOnce()).resolves.toEqual(result);
    expect(database.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns zero counts when a cycle returns no row', async () => {
    const database = { $queryRaw: jest.fn().mockResolvedValue([]) };
    const worker = new AutomationWorkerService(
      database as never,
      {
        enabled: true,
        pollIntervalMs: 5_000,
        batchSize: 50,
      } as never,
    );

    await expect(worker.runOnce()).resolves.toEqual({
      atRiskCount: 0,
      breachedCount: 0,
      escalationCount: 0,
      expiredApprovalCount: 0,
    });
  });

  it('does not query when intentionally disabled', async () => {
    const database = { $queryRaw: jest.fn() };
    const worker = new AutomationWorkerService(
      database as never,
      {
        enabled: false,
        pollIntervalMs: 5_000,
        batchSize: 50,
      } as never,
    );

    await expect(worker.runOnce()).resolves.toBeNull();
    expect(database.$queryRaw).not.toHaveBeenCalled();
  });
});
