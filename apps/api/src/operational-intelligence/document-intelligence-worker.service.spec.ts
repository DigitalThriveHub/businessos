import { createHash } from 'node:crypto';

import type { PrismaService } from '../database/prisma.service';
import type { SupabasePrivateStorageService } from '../document-scanner/supabase-storage.service';
import type { DocumentIntelligenceProviderService } from './document-intelligence-provider.service';
import type { OperationalIntelligenceConfig } from './operational-intelligence.config';
import { DocumentIntelligenceWorkerService } from './document-intelligence-worker.service';

const bytes = Buffer.from('clean private document');
const job = {
  jobId: '11111111-1111-4111-8111-111111111111',
  organisationId: '22222222-2222-4222-8222-222222222222',
  analysisId: '33333333-3333-4333-8333-333333333333',
  matterId: '44444444-4444-4444-8444-444444444444',
  documentId: '55555555-5555-4555-8555-555555555555',
  versionId: '66666666-6666-4666-8666-666666666666',
  storageBucket: 'businessos-documents',
  storagePath: 'org/matter/document/file.pdf',
  originalFileName: 'evidence.pdf',
  contentType: 'application/pdf',
  expectedSizeBytes: bytes.length,
  expectedSha256Hex: createHash('sha256').update(bytes).digest('hex'),
  documentTitle: 'Evidence',
  currentCategory: 'GENERAL',
  attempt: 1,
  maxAttempts: 5,
};

function config(enabled = true): OperationalIntelligenceConfig {
  return {
    enabled,
    workerIdPrefix: 'test-worker',
    pollIntervalMs: 5_000,
    leaseSeconds: 300,
    maxFileBytes: 20_971_520,
  } as OperationalIntelligenceConfig;
}

function storage(content = bytes): SupabasePrivateStorageService {
  return {
    download: jest.fn().mockResolvedValue({
      chunks: (async function* () {
        yield content;
      })(),
      contentLength: content.length,
      contentType: 'application/pdf',
      cancel: jest.fn(),
    }),
  } as unknown as SupabasePrivateStorageService;
}

function provider(): DocumentIntelligenceProviderService {
  return {
    analyse: jest.fn().mockResolvedValue({
      responseId: 'resp_document_123',
      requestId: 'req_document_123',
      model: 'approved-vision-model',
      latencyMs: 20,
      output: {
        detectedCategory: 'EVIDENCE',
        categoryConfidenceBps: 9000,
        extractedFields: [],
        extractedNames: [],
        extractedDates: [],
        expiryDate: null,
        missingPages: [],
        missingInformation: [],
        inconsistencies: [],
        summary: 'Evidence ready for human review.',
        reviewPriority: 'ROUTINE',
      },
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        estimatedCostMinor: 1,
      },
    }),
  } as unknown as DocumentIntelligenceProviderService;
}

describe('DocumentIntelligenceWorkerService', () => {
  it('does not claim work when provider processing is disabled', async () => {
    const database = { $queryRaw: jest.fn() } as unknown as PrismaService;
    const worker = new DocumentIntelligenceWorkerService(
      database,
      config(false),
      storage(),
      provider(),
    );
    await expect(worker.runOnce()).resolves.toBe(false);
    expect(database.$queryRaw).not.toHaveBeenCalled();
  });

  it('verifies clean storage evidence and commits structured output', async () => {
    const database = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([job])
        .mockResolvedValueOnce([
          {
            analysisId: job.analysisId,
            analysisStatus: 'READY',
            jobStatus: 'SUCCEEDED',
          },
        ]),
    } as unknown as PrismaService;
    const providerService = provider();
    const worker = new DocumentIntelligenceWorkerService(
      database,
      config(),
      storage(),
      providerService,
    );
    await expect(worker.runOnce()).resolves.toBe(true);
    expect(providerService.analyse).toHaveBeenCalledWith(
      expect.objectContaining({
        bytes,
        fileName: 'evidence.pdf',
        contentType: 'application/pdf',
      }),
    );
    expect(database.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('fails closed when storage content no longer matches scan evidence', async () => {
    const changed = Buffer.from('changed after scan');
    const database = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ ...job, expectedSizeBytes: changed.length }])
        .mockResolvedValueOnce([
          { analysisStatus: 'ERROR', jobStatus: 'DEAD_LETTER' },
        ]),
    } as unknown as PrismaService;
    const providerService = provider();
    const worker = new DocumentIntelligenceWorkerService(
      database,
      config(),
      storage(changed),
      providerService,
    );
    await expect(worker.runOnce()).resolves.toBe(true);
    expect(providerService.analyse).not.toHaveBeenCalled();
    expect(database.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('rejects unsupported document types before provider transmission', async () => {
    const database = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ ...job, contentType: 'application/zip' }])
        .mockResolvedValueOnce([
          { analysisStatus: 'ERROR', jobStatus: 'DEAD_LETTER' },
        ]),
    } as unknown as PrismaService;
    const providerService = provider();
    const worker = new DocumentIntelligenceWorkerService(
      database,
      config(),
      storage(),
      providerService,
    );
    await expect(worker.runOnce()).resolves.toBe(true);
    expect(providerService.analyse).not.toHaveBeenCalled();
  });
});
