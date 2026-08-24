import { OperationalReadinessService } from './operational-readiness.service';

describe('OperationalReadinessService', () => {
  const values: Record<string, unknown> = {
    OPERATIONS_HEALTH_TOKEN: 'a'.repeat(48),
    AUTOMATION_WORKER_ENABLED: 'true',
    COMMUNICATION_DELIVERY_ENABLED: 'true',
    DOCUMENT_SCANNER_ENABLED: 'true',
    SUPABASE_PITR_ENABLED: 'true',
    RELEASE_SHA: 'abcdef123456',
    BACKUP_RESTORE_EVIDENCE_AT: '2026-08-24T00:00:00.000Z',
    RECOVERY_POINT_OBJECTIVE_MINUTES: 5,
    RECOVERY_TIME_OBJECTIVE_MINUTES: 60,
  };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => values[key] ?? fallback),
  };

  it('rejects missing or incorrect operations tokens', () => {
    const service = new OperationalReadinessService(
      {} as never,
      config as never,
    );
    expect(() => service.authorise(undefined)).toThrow('unauthorised');
    expect(() => service.authorise('incorrect')).toThrow('unauthorised');
    expect(() => service.authorise('a'.repeat(48))).not.toThrow();
  });

  it('reports an operational platform when workers and queues are healthy', async () => {
    const database = {
      $queryRaw: jest.fn().mockResolvedValueOnce([
        {
          communication_ready: 0n,
          scanner_ready: 0n,
          scanner_dead_letter: 0n,
          workflow_ready: 0n,
          integration_failed_24_hours: 0n,
        },
      ]),
    };
    const service = new OperationalReadinessService(
      database as never,
      config as never,
    );
    await expect(service.diagnostics()).resolves.toMatchObject({
      status: 'operational',
      release: 'abcdef123456',
      workers: {
        automation: true,
        communicationDelivery: true,
        documentScanner: true,
      },
      queues: { scannerDeadLetter: 0, integrationFailed24Hours: 0 },
      alerts: [],
    });
  });
});
