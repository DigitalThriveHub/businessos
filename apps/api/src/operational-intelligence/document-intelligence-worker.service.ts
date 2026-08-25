import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';
import { SupabasePrivateStorageService } from '../document-scanner/supabase-storage.service';
import { DocumentIntelligenceProviderService } from './document-intelligence-provider.service';
import { OperationalIntelligenceConfig } from './operational-intelligence.config';
import {
  type ClaimedDocumentIntelligenceJob,
  DocumentIntelligencePipelineError,
} from './operational-intelligence.types';

const SUPPORTED_CONTENT_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

interface FailureResult {
  analysisStatus: string;
  jobStatus: string;
}

interface CompletionResult {
  analysisId: string;
  analysisStatus: string;
  jobStatus: string;
}

@Injectable()
export class DocumentIntelligenceWorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DocumentIntelligenceWorkerService.name);
  private readonly workerId: string;
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private stopping = false;
  private cancelDownload: (() => void) | null = null;

  constructor(
    private readonly database: PrismaService,
    private readonly config: OperationalIntelligenceConfig,
    private readonly storage: SupabasePrivateStorageService,
    private readonly provider: DocumentIntelligenceProviderService,
  ) {
    this.workerId =
      `${config.workerIdPrefix}-${hostname().slice(0, 40)}-${process.pid}-${randomUUID().slice(0, 8)}`.slice(
        0,
        160,
      );
  }

  onModuleInit(): void {
    if (!this.config.enabled) {
      this.logger.log(
        'Document intelligence is disabled; clean documents remain available for manual review.',
      );
      return;
    }
    this.logger.log('Document-intelligence worker enabled.');
    this.schedule(0);
  }

  onModuleDestroy(): void {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.cancelDownload?.();
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
            `Document-intelligence cycle failed; errorType=${
              error instanceof Error ? error.name : 'unknown'
            }`,
          );
        })
        .finally(() => this.schedule(this.config.pollIntervalMs));
    }, delayMs);
    this.timer.unref();
  }

  private async claim(): Promise<ClaimedDocumentIntelligenceJob | null> {
    const [job] = await this.database.$queryRaw<
      ClaimedDocumentIntelligenceJob[]
    >`
      SELECT
        job_id AS "jobId",
        organisation_id AS "organisationId",
        analysis_id AS "analysisId",
        matter_id AS "matterId",
        document_id AS "documentId",
        version_id AS "versionId",
        storage_bucket AS "storageBucket",
        storage_path AS "storagePath",
        original_file_name AS "originalFileName",
        content_type AS "contentType",
        expected_size_bytes AS "expectedSizeBytes",
        expected_sha256_hex AS "expectedSha256Hex",
        document_title AS "documentTitle",
        current_category AS "currentCategory",
        attempt,
        max_attempts AS "maxAttempts"
      FROM private.claim_document_intelligence_job(
        ${this.workerId},
        ${this.config.leaseSeconds}
      )
    `;
    return job ?? null;
  }

  private async process(job: ClaimedDocumentIntelligenceJob): Promise<void> {
    try {
      const expectedSize = Number(job.expectedSizeBytes);
      if (
        !Number.isSafeInteger(expectedSize) ||
        expectedSize < 1 ||
        expectedSize > this.config.maxFileBytes
      ) {
        throw new DocumentIntelligencePipelineError(
          'FILE_SIZE_NOT_SUPPORTED',
          'The clean document exceeds the approved intelligence size.',
          false,
        );
      }

      const registeredContentType = job.contentType
        .split(';', 1)[0]
        ?.trim()
        .toLowerCase();
      if (
        !registeredContentType ||
        !SUPPORTED_CONTENT_TYPES.has(registeredContentType)
      ) {
        throw new DocumentIntelligencePipelineError(
          'FILE_TYPE_NOT_SUPPORTED',
          'The clean document type is not supported for intelligence.',
          false,
        );
      }

      const download = await this.storage.download(
        job.storageBucket,
        job.storagePath,
      );
      this.cancelDownload = download.cancel;
      try {
        if (
          download.contentLength !== null &&
          download.contentLength !== expectedSize
        ) {
          throw new DocumentIntelligencePipelineError(
            'STORAGE_SIZE_MISMATCH',
            'The private object size no longer matches its registered size.',
            false,
          );
        }
        const observedContentType = download.contentType
          ?.split(';', 1)[0]
          ?.trim()
          .toLowerCase();
        if (observedContentType !== registeredContentType) {
          throw new DocumentIntelligencePipelineError(
            'STORAGE_CONTENT_TYPE_MISMATCH',
            'The private object type no longer matches its registered type.',
            false,
          );
        }

        const hash = createHash('sha256');
        const chunks: Buffer[] = [];
        let observedSize = 0;
        for await (const rawChunk of download.chunks) {
          const chunk = Buffer.from(rawChunk);
          observedSize += chunk.length;
          if (observedSize > this.config.maxFileBytes) {
            throw new DocumentIntelligencePipelineError(
              'FILE_SIZE_NOT_SUPPORTED',
              'The private object exceeds the approved intelligence size.',
              false,
            );
          }
          hash.update(chunk);
          chunks.push(chunk);
        }
        if (observedSize !== expectedSize) {
          throw new DocumentIntelligencePipelineError(
            'STORAGE_SIZE_MISMATCH',
            'The downloaded object size does not match its registered size.',
            false,
          );
        }
        if (hash.digest('hex') !== job.expectedSha256Hex) {
          throw new DocumentIntelligencePipelineError(
            'STORAGE_HASH_MISMATCH',
            'The downloaded object hash does not match its clean scan evidence.',
            false,
          );
        }

        const result = await this.provider.analyse({
          bytes: Buffer.concat(chunks, observedSize),
          fileName: job.originalFileName.replace(/[\u0000-\u001f\u007f]/g, '_'),
          contentType: registeredContentType,
          documentTitle: job.documentTitle,
          currentCategory: job.currentCategory,
        });

        const [completion] = await this.database.$queryRaw<CompletionResult[]>`
          SELECT
            analysis_id AS "analysisId",
            analysis_status AS "analysisStatus",
            job_status AS "jobStatus"
          FROM private.complete_document_intelligence_job(
            ${job.jobId}::uuid,
            ${this.workerId},
            'openai',
            ${result.model},
            ${result.responseId},
            ${result.requestId ?? ''},
            ${result.output.detectedCategory}::public.document_category,
            ${result.output.categoryConfidenceBps},
            ${JSON.stringify({ items: result.output.extractedFields })}::jsonb,
            ${result.output.extractedNames}::text[],
            ${JSON.stringify(result.output.extractedDates)}::jsonb,
            ${result.output.expiryDate ?? null}::date,
            ${result.output.missingPages}::integer[],
            ${result.output.missingInformation}::text[],
            ${result.output.inconsistencies}::text[],
            ${result.output.summary},
            ${result.output.reviewPriority}::public.document_review_priority,
            ${result.usage.inputTokens},
            ${result.usage.outputTokens},
            ${result.usage.totalTokens},
            ${result.usage.estimatedCostMinor}::bigint
          )
        `;
        if (!completion) {
          throw new DocumentIntelligencePipelineError(
            'COMPLETION_REJECTED',
            'The document-intelligence result could not be committed.',
            true,
          );
        }
        this.logger.log(
          `Document intelligence completed; analysisId=${completion.analysisId}; status=${completion.analysisStatus}`,
        );
      } finally {
        download.cancel();
        this.cancelDownload = null;
      }
    } catch (error) {
      const pipelineError =
        error instanceof DocumentIntelligencePipelineError
          ? error
          : new DocumentIntelligencePipelineError(
              'INTELLIGENCE_UNEXPECTED_ERROR',
              'The document-intelligence worker encountered an unexpected failure.',
              true,
              { cause: error },
            );
      const [failure] = await this.database.$queryRaw<FailureResult[]>`
        SELECT
          analysis_status AS "analysisStatus",
          job_status AS "jobStatus"
        FROM private.fail_document_intelligence_job(
          ${job.jobId}::uuid,
          ${this.workerId},
          ${pipelineError.code},
          ${pipelineError.message},
          ${pipelineError.retryable}
        )
      `;
      this.logger.warn(
        `Document intelligence failed; analysisId=${job.analysisId}; code=${pipelineError.code}; status=${failure?.jobStatus ?? 'UNKNOWN'}`,
      );
    }
  }
}
