import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';
import { ClamAvClientService } from './clamav-client.service';
import { DocumentScannerConfig } from './document-scanner.config';
import {
  ScannerPipelineError,
  type ClaimedDocumentScanJob,
  type ScanJobCompletion,
} from './document-scanner.types';
import { SupabasePrivateStorageService } from './supabase-storage.service';

interface FailureResult {
  jobStatus: string;
}

@Injectable()
export class DocumentScanWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DocumentScanWorkerService.name);
  private readonly workerId: string;
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private stopping = false;
  private cancelCurrentDownload: (() => void) | null = null;

  constructor(
    private readonly database: PrismaService,
    private readonly config: DocumentScannerConfig,
    private readonly storage: SupabasePrivateStorageService,
    private readonly clamav: ClamAvClientService,
  ) {
    this.workerId = `${config.workerIdPrefix}-${hostname().slice(0, 40)}-${process.pid}-${randomUUID().slice(0, 8)}`
      .slice(0, 160);
  }

  onModuleInit(): void {
    if (!this.config.enabled) {
      this.logger.log('Document scanner is disabled; quarantined uploads remain fail-closed.');
      return;
    }
    this.logger.log('Document scanner worker enabled.');
    this.schedule(0);
  }

  onModuleDestroy(): void {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.cancelCurrentDownload?.();
  }

  async runOnce(): Promise<boolean> {
    if (!this.config.enabled || this.busy || this.stopping) return false;
    this.busy = true;
    try {
      const job = await this.claim();
      if (!job) return false;
      await this.process(job);
      return true;
    } finally {
      this.busy = false;
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      void this.runOnce()
        .catch((error: unknown) => {
          this.logger.error(
            `Scanner worker cycle failed; errorType=${error instanceof Error ? error.name : 'unknown'}`,
          );
        })
        .finally(() => this.schedule(this.config.pollIntervalMs));
    }, delayMs);
    this.timer.unref();
  }

  private async claim(): Promise<ClaimedDocumentScanJob | null> {
    const [job] = await this.database.$queryRaw<ClaimedDocumentScanJob[]>`
      SELECT
        job_id AS "jobId",
        organisation_id AS "organisationId",
        matter_id AS "matterId",
        document_id AS "documentId",
        version_id AS "versionId",
        storage_bucket AS "storageBucket",
        storage_path AS "storagePath",
        expected_sha256_hex AS "expectedSha256Hex",
        expected_size_bytes AS "expectedSizeBytes",
        content_type AS "contentType",
        attempt,
        max_attempts AS "maxAttempts"
      FROM private.claim_document_scan_job(
        ${this.workerId},
        ${this.config.leaseSeconds}
      )
    `;
    return job ?? null;
  }

  private async process(job: ClaimedDocumentScanJob): Promise<void> {
    try {
      const expectedSizeBytes = Number(job.expectedSizeBytes);
      if (!Number.isSafeInteger(expectedSizeBytes)) {
        throw new ScannerPipelineError(
          'REGISTERED_SIZE_INVALID',
          'The registered document size is invalid.',
          false,
        );
      }

      const download = await this.storage.download(job.storageBucket, job.storagePath);
      this.cancelCurrentDownload = download.cancel;
      try {
        if (
          download.contentLength !== null &&
          download.contentLength !== expectedSizeBytes
        ) {
          throw new ScannerPipelineError(
            'STORAGE_SIZE_MISMATCH',
            'The private object size differs from the registered size.',
            false,
          );
        }
        const observedContentType = download.contentType
          ?.split(';', 1)[0]
          ?.trim()
          .toLowerCase();
        if (observedContentType !== job.contentType.toLowerCase()) {
          throw new ScannerPipelineError(
            'STORAGE_CONTENT_TYPE_MISMATCH',
            'The private object content type differs from its registered type.',
            false,
          );
        }
        const verdict = await this.clamav.scan(download.chunks, expectedSizeBytes);
        const [completion] = await this.database.$queryRaw<ScanJobCompletion[]>`
          SELECT
            job_status AS "jobStatus",
            document_status AS "documentStatus",
            scan_status AS "scanStatus"
          FROM private.complete_document_scan_job(
            ${job.jobId}::uuid,
            ${this.workerId},
            ${verdict.result}::public.document_scan_status,
            'clamav',
            ${`clamav:${job.jobId}:${job.attempt}`},
            ${verdict.observedSha256Hex},
            ${verdict.engineVersion},
            ${verdict.signature}
          )
        `;
        if (!completion) {
          throw new ScannerPipelineError(
            'SCAN_COMPLETION_REJECTED',
            'The scan result could not be committed.',
            true,
          );
        }
        this.logger.log(
          `Document scan completed; jobId=${job.jobId}; result=${completion.scanStatus}`,
        );
      } finally {
        download.cancel();
        this.cancelCurrentDownload = null;
      }
    } catch (error) {
      const pipelineError =
        error instanceof ScannerPipelineError
          ? error
          : new ScannerPipelineError(
              'SCANNER_UNEXPECTED_ERROR',
              'The scanner worker encountered an unexpected failure.',
              true,
              { cause: error },
            );
      const [failure] = await this.database.$queryRaw<FailureResult[]>`
        SELECT job_status AS "jobStatus"
        FROM private.fail_document_scan_job(
          ${job.jobId}::uuid,
          ${this.workerId},
          ${pipelineError.code},
          ${pipelineError.message},
          ${pipelineError.retryable}
        )
      `;
      this.logger.warn(
        `Document scan failed; jobId=${job.jobId}; code=${pipelineError.code}; status=${failure?.jobStatus ?? 'UNKNOWN'}`,
      );
    }
  }
}