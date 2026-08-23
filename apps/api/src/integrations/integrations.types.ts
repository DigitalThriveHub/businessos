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
