export const DOCUMENT_SCAN_JOB_STATUSES = [
  'QUEUED',
  'LEASED',
  'SUCCEEDED',
  'FAILED',
  'DEAD_LETTER',
] as const;

export type DocumentScanJobStatus =
  (typeof DOCUMENT_SCAN_JOB_STATUSES)[number];

export type ScannerTerminalResult = 'CLEAN' | 'INFECTED' | 'ERROR';

export interface ClaimedDocumentScanJob {
  jobId: string;
  organisationId: string;
  matterId: string;
  documentId: string;
  versionId: string;
  storageBucket: string;
  storagePath: string;
  expectedSha256Hex: string;
  expectedSizeBytes: bigint | number;
  contentType: string;
  attempt: number;
  maxAttempts: number;
}

export interface ScannerVerdict {
  result: Exclude<ScannerTerminalResult, 'ERROR'>;
  observedSha256Hex: string;
  observedSizeBytes: number;
  engineVersion: string;
  signature: string | null;
}

export interface ScanJobCompletion {
  jobStatus: DocumentScanJobStatus;
  documentStatus: string;
  scanStatus: ScannerTerminalResult;
}

export class ScannerPipelineError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ScannerPipelineError';
  }
}