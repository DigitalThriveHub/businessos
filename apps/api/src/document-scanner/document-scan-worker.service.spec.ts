import { ScannerPipelineError } from './document-scanner.types';
import { DocumentScanWorkerService } from './document-scan-worker.service';

const JOB = {
  jobId: '11111111-1111-4111-8111-111111111111',
  organisationId: '22222222-2222-4222-8222-222222222222',
  matterId: '33333333-3333-4333-8333-333333333333',
  documentId: '44444444-4444-4444-8444-444444444444',
  versionId: '55555555-5555-4555-8555-555555555555',
  storageBucket: 'businessos-documents',
  storagePath: 'org/matter/document/version/file.pdf',
  expectedSha256Hex: 'a'.repeat(64),
  expectedSizeBytes: 4n,
  contentType: 'application/pdf',
  attempt: 1,
  maxAttempts: 5,
};

describe('DocumentScanWorkerService', () => {
  const config = {
    enabled: true,
    pollIntervalMs: 5_000,
    leaseSeconds: 180,
  };

  it('claims, scans and atomically completes a clean document job', async () => {
    const database = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([JOB])
        .mockResolvedValueOnce([
          {
            jobStatus: 'SUCCEEDED',
            documentStatus: 'AVAILABLE',
            scanStatus: 'CLEAN',
          },
        ]),
    };
    const cancel = jest.fn();
    const storage = {
      download: jest.fn().mockResolvedValue({
        chunks: (async function* () {
          yield new Uint8Array([1, 2, 3, 4]);
        })(),
        contentLength: 4,
        contentType: 'application/pdf',
        cancel,
      }),
    };
    const clamav = {
      scan: jest.fn().mockResolvedValue({
        result: 'CLEAN',
        observedSha256Hex: 'a'.repeat(64),
        observedSizeBytes: 4,
        engineVersion: 'ClamAV 1.4.3',
        signature: null,
      }),
    };

    const worker = new DocumentScanWorkerService(
      database as never,
      config as never,
      storage as never,
      clamav as never,
    );

    await expect(worker.runOnce()).resolves.toBe(true);
    expect(storage.download).toHaveBeenCalledWith(
      JOB.storageBucket,
      JOB.storagePath,
    );
    expect(clamav.scan).toHaveBeenCalledWith(expect.any(Object), 4);
    expect(database.$queryRaw).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('records a retryable pipeline failure without releasing the file', async () => {
    const database = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([JOB])
        .mockResolvedValueOnce([{ jobStatus: 'QUEUED' }]),
    };
    const storage = {
      download: jest
        .fn()
        .mockRejectedValue(
          new ScannerPipelineError(
            'STORAGE_UNAVAILABLE',
            'Storage unavailable.',
            true,
          ),
        ),
    };
    const worker = new DocumentScanWorkerService(
      database as never,
      config as never,
      storage as never,
      { scan: jest.fn() } as never,
    );

    await expect(worker.runOnce()).resolves.toBe(true);
    expect(database.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('dead-letters an object whose storage metadata does not match registration', async () => {
    const database = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([JOB])
        .mockResolvedValueOnce([{ jobStatus: 'DEAD_LETTER' }]),
    };
    const cancel = jest.fn();
    const storage = {
      download: jest.fn().mockResolvedValue({
        chunks: (async function* () {
          yield new Uint8Array([1, 2, 3, 4]);
        })(),
        contentLength: 4,
        contentType: 'text/plain; charset=utf-8',
        cancel,
      }),
    };
    const clamav = { scan: jest.fn() };
    const worker = new DocumentScanWorkerService(
      database as never,
      config as never,
      storage as never,
      clamav as never,
    );

    await expect(worker.runOnce()).resolves.toBe(true);
    expect(clamav.scan).not.toHaveBeenCalled();
    expect(database.$queryRaw).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the scanner is intentionally disabled', async () => {
    const database = { $queryRaw: jest.fn() };
    const worker = new DocumentScanWorkerService(
      database as never,
      { ...config, enabled: false } as never,
      { download: jest.fn() } as never,
      { scan: jest.fn() } as never,
    );

    await expect(worker.runOnce()).resolves.toBe(false);
    expect(database.$queryRaw).not.toHaveBeenCalled();
  });
});
