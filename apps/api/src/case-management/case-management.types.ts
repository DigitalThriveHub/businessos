export const CLIENT_KINDS = ['INDIVIDUAL', 'ORGANISATION'] as const;
export type ClientKind = (typeof CLIENT_KINDS)[number];

export const CLIENT_STATUSES = [
  'ONBOARDING',
  'ACTIVE',
  'INACTIVE',
  'ARCHIVED',
] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const CLIENT_RISK_RATINGS = [
  'NOT_ASSESSED',
  'LOW',
  'MEDIUM',
  'HIGH',
] as const;
export type ClientRiskRating = (typeof CLIENT_RISK_RATINGS)[number];

export const IDENTITY_VERIFICATION_STATUSES = [
  'NOT_STARTED',
  'PENDING',
  'VERIFIED',
  'FAILED',
  'EXPIRED',
] as const;
export type IdentityVerificationStatus =
  (typeof IDENTITY_VERIFICATION_STATUSES)[number];

export const PROCESSING_LAWFUL_BASES = [
  'CONTRACT',
  'LEGAL_OBLIGATION',
  'LEGITIMATE_INTEREST',
  'CONSENT',
  'VITAL_INTEREST',
  'PUBLIC_TASK',
] as const;
export type ProcessingLawfulBasis =
  (typeof PROCESSING_LAWFUL_BASES)[number];

export const COMMUNICATION_CHANNELS = [
  'EMAIL',
  'PHONE',
  'SMS',
  'WHATSAPP',
  'POST',
  'NONE',
] as const;
export type CommunicationChannel =
  (typeof COMMUNICATION_CHANNELS)[number];

export const MATTER_STATUSES = [
  'INTAKE',
  'CONFLICT_CHECK',
  'CLIENT_CARE',
  'AWAITING_DOCUMENTS',
  'ACTIVE',
  'SUBMITTED',
  'DECISION_RECEIVED',
  'ON_HOLD',
  'CLOSED',
  'CANCELLED',
  'ARCHIVED',
] as const;
export type MatterStatus = (typeof MATTER_STATUSES)[number];

export const MATTER_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type MatterPriority = (typeof MATTER_PRIORITIES)[number];

export const MATTER_PARTY_ROLES = [
  'PRIMARY_CLIENT',
  'DEPENDANT',
  'SPONSOR',
  'EMPLOYER',
  'REPRESENTATIVE',
  'OTHER',
] as const;
export type MatterPartyRole = (typeof MATTER_PARTY_ROLES)[number];

export const ADDITIONAL_MATTER_PARTY_ROLES = [
  'DEPENDANT',
  'SPONSOR',
  'EMPLOYER',
  'REPRESENTATIVE',
  'OTHER',
] as const;
export type AdditionalMatterPartyRole =
  (typeof ADDITIONAL_MATTER_PARTY_ROLES)[number];

export const CONFLICT_CHECK_STATUSES = [
  'NOT_STARTED',
  'PENDING',
  'CLEARED',
  'FLAGGED',
  'WAIVED',
] as const;
export type ConflictCheckStatus =
  (typeof CONFLICT_CHECK_STATUSES)[number];

export const AML_CHECK_STATUSES = [
  'NOT_REQUIRED',
  'NOT_STARTED',
  'PENDING',
  'VERIFIED',
  'FAILED',
  'EXPIRED',
] as const;
export type AmlCheckStatus = (typeof AML_CHECK_STATUSES)[number];

export const CLIENT_CARE_STATUSES = [
  'NOT_SENT',
  'SENT',
  'ACCEPTED',
  'DECLINED',
] as const;
export type ClientCareStatus = (typeof CLIENT_CARE_STATUSES)[number];

export interface PaginationView {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ClientView {
  id: string;
  organisationId: string;
  clientNumber: string;
  sourceEnquiryId: string | null;
  kind: ClientKind;
  status: ClientStatus;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  organisationName: string | null;
  email: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  nationality: string | null;
  countryOfResidenceCode: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  addressCountryCode: string | null;
  preferredLanguage: string;
  preferredCommunication: CommunicationChannel;
  processingLawfulBasis: ProcessingLawfulBasis;
  privacyNoticeVersion: string | null;
  privacyNoticeAcknowledgedAt: string | null;
  marketingConsent: boolean;
  marketingConsentAt: string | null;
  marketingConsentSource: string | null;
  riskRating: ClientRiskRating;
  identityVerificationStatus: IdentityVerificationStatus;
  identityVerifiedAt: string | null;
  identityVerificationExpiresAt: string | null;
  assignedToUserId: string | null;
  assignedToName: string | null;
  lastContactedAt: string | null;
  retentionReviewAt: string | null;
  archivedAt: string | null;
  archiveReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClientListView {
  items: ClientView[];
  pagination: PaginationView;
}

export interface MatterSummaryView {
  id: string;
  matterNumber: string;
  title: string;
  serviceType: string;
  status: MatterStatus;
  priority: MatterPriority;
  primaryClientId: string;
  primaryClientName: string;
  assignedToUserId: string | null;
  assignedToName: string | null;
  departmentId: string | null;
  teamId: string | null;
  nextActionAt: string | null;
  criticalDeadlineAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface MatterComplianceView {
  id: string;
  conflictStatus: ConflictCheckStatus;
  conflictReference: string | null;
  conflictCheckedAt: string | null;
  conflictCheckedByUserId: string | null;
  amlStatus: AmlCheckStatus;
  amlReference: string | null;
  amlCheckedAt: string | null;
  amlCheckedByUserId: string | null;
  clientCareStatus: ClientCareStatus;
  clientCareSentAt: string | null;
  clientCareRespondedAt: string | null;
  riskRating: ClientRiskRating;
  riskReason: string | null;
  riskReviewedAt: string | null;
  riskReviewedByUserId: string | null;
  version: number;
  updatedAt: string;
}

export interface MatterPartyView {
  id: string;
  clientId: string;
  clientNumber: string;
  clientName: string;
  role: MatterPartyRole;
  isPrimary: boolean;
  roleDescription: string | null;
  updatedAt: string;
}

export interface MatterStatusHistoryView {
  id: string;
  fromStatus: MatterStatus | null;
  toStatus: MatterStatus;
  reason: string;
  changedByUserId: string;
  changedByName: string;
  occurredAt: string;
}

export interface MatterView extends MatterSummaryView {
  organisationId: string;
  sourceEnquiryId: string | null;
  description: string | null;
  jurisdictionCountryCode: string | null;
  externalReference: string | null;
  supervisorUserId: string | null;
  supervisorName: string | null;
  nextActionSummary: string | null;
  targetCompletionAt: string | null;
  openedAt: string;
  closedAt: string | null;
  closureReason: string | null;
  outcome: string | null;
  archivedAt: string | null;
  archiveReason: string | null;
  compliance: MatterComplianceView;
  parties: MatterPartyView[];
  statusHistory: MatterStatusHistoryView[];
}

export interface MatterListView {
  items: MatterSummaryView[];
  pagination: PaginationView;
}

export interface CaseManagementOption {
  id: string;
  label: string;
}

export interface CaseManagementTeamOption extends CaseManagementOption {
  departmentId: string | null;
}

export interface CaseManagementOptionsView {
  departments: CaseManagementOption[];
  teams: CaseManagementTeamOption[];
  members: CaseManagementOption[];
  clients: Array<CaseManagementOption & { clientNumber: string }>;
  convertibleEnquiries: Array<
    CaseManagementOption & {
      status: 'QUALIFIED' | 'CONSULTATION_BOOKED';
      serviceType: string | null;
    }
  >;
}

export interface EnquiryConversionResult {
  enquiryId: string;
  clientId: string;
  matterId: string;
  clientNumber: string;
  matterNumber: string;
  repeated: boolean;
}