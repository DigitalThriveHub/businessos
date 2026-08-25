import { z } from 'zod';

export const DOCUMENT_CATEGORIES = [
  'GENERAL',
  'IDENTITY',
  'FINANCIAL',
  'LEGAL',
  'EVIDENCE',
  'CLIENT_CARE',
  'SUBMISSION',
  'DECISION',
  'CORRESPONDENCE',
  'OTHER',
] as const;

export const DOCUMENT_REVIEW_DECISIONS = [
  'ACCEPTED',
  'CORRECTED',
  'REJECTED',
] as const;

export const DOCUMENT_REVIEW_PRIORITIES = [
  'ROUTINE',
  'ATTENTION',
  'URGENT',
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];
export type DocumentReviewDecision = (typeof DOCUMENT_REVIEW_DECISIONS)[number];
export type DocumentReviewPriority =
  (typeof DOCUMENT_REVIEW_PRIORITIES)[number];

const extractedFieldSchema = z.object({
  label: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(1000),
  confidenceBps: z.number().int().min(0).max(10_000),
});

const extractedDateSchema = z.object({
  label: z.string().trim().min(1).max(120),
  value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  confidenceBps: z.number().int().min(0).max(10_000),
});

export const documentIntelligenceOutputSchema = z.object({
  detectedCategory: z.enum(DOCUMENT_CATEGORIES),
  categoryConfidenceBps: z.number().int().min(0).max(10_000),
  extractedFields: z.array(extractedFieldSchema).max(100),
  extractedNames: z.array(z.string().trim().min(1).max(240)).max(100),
  extractedDates: z.array(extractedDateSchema).max(100),
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  missingPages: z.array(z.number().int().min(1).max(10_000)).max(500),
  missingInformation: z.array(z.string().trim().min(1).max(500)).max(100),
  inconsistencies: z.array(z.string().trim().min(1).max(500)).max(100),
  summary: z.string().trim().min(3).max(4000),
  reviewPriority: z.enum(DOCUMENT_REVIEW_PRIORITIES),
});

export type DocumentIntelligenceOutput = z.infer<
  typeof documentIntelligenceOutputSchema
>;

export interface ClaimedDocumentIntelligenceJob {
  jobId: string;
  organisationId: string;
  analysisId: string;
  matterId: string;
  documentId: string;
  versionId: string;
  storageBucket: string;
  storagePath: string;
  originalFileName: string;
  contentType: string;
  expectedSizeBytes: bigint | number;
  expectedSha256Hex: string;
  documentTitle: string;
  currentCategory: DocumentCategory;
  attempt: number;
  maxAttempts: number;
}

export interface DocumentIntelligenceProviderResult {
  responseId: string;
  requestId: string | null;
  model: string;
  latencyMs: number;
  output: DocumentIntelligenceOutput;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostMinor: number;
  };
}

export class DocumentIntelligencePipelineError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'DocumentIntelligencePipelineError';
  }
}
