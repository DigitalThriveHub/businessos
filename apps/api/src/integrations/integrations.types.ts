export type IntegrationRecord = Record<string, unknown>;

export interface IngressContextRow {
  organisationId: string;
  provider: 'WORDPRESS' | 'GENERIC';
  displayName: string;
  secretVersion: number;
}

export interface ExternalEnquiryResultRow {
  eventId: string;
  enquiryId: string;
  duplicate: boolean;
  correlationId: string;
}

export interface PublicIntakeFormRow {
  id: string;
  organisationId: string;
  connectionId: string;
  publicId: string;
  name: string;
  description: string | null;
  formSchema: unknown;
  privacyNoticeUrl: string;
  privacyNoticeVersion: string;
  allowedOrigins: string[];
  successMessage: string;
  submitButtonLabel: string;
  honeypotField: string;
}

export interface PublicIntakeResultRow {
  submissionId: string;
  enquiryId: string;
  duplicate: boolean;
  correlationId: string;
}

export interface ExternalCommunicationResultRow {
  eventId: string;
  conversationId: string;
  messageId: string;
  queuedForMatching: boolean;
  duplicate: boolean;
  correlationId: string;
}
