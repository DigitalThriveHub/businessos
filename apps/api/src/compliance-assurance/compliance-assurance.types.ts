export const DATA_SUBJECT_REQUEST_TYPES = [
  'ACCESS',
  'RECTIFICATION',
  'ERASURE',
  'RESTRICTION',
  'PORTABILITY',
  'OBJECTION',
  'AUTOMATED_DECISION_REVIEW',
] as const;

export const DATA_SUBJECT_REQUEST_STATUSES = [
  'RECEIVED',
  'IDENTITY_VERIFICATION',
  'IN_PROGRESS',
  'ON_HOLD',
  'READY_FOR_REVIEW',
  'COMPLETED',
  'REFUSED',
  'WITHDRAWN',
] as const;

export const IDENTITY_PROOF_STATUSES = [
  'NOT_STARTED',
  'PENDING',
  'VERIFIED',
  'FAILED',
] as const;

export const PRIVACY_INCIDENT_SEVERITIES = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
] as const;

export const PRIVACY_INCIDENT_STATUSES = [
  'OPEN',
  'CONTAINING',
  'INVESTIGATING',
  'NOTIFICATION_DECISION',
  'RESOLVED',
  'CLOSED',
] as const;

export const BREACH_NOTIFICATION_DECISIONS = [
  'UNASSESSED',
  'NOT_REPORTABLE',
  'ICO_REQUIRED',
  'ICO_NOTIFIED',
  'SUBJECTS_REQUIRED',
  'SUBJECTS_NOTIFIED',
] as const;

export const RETENTION_ACTIONS = [
  'REVIEW',
  'RETAIN',
  'ARCHIVE',
  'ANONYMISE',
  'DELETE',
] as const;

export const RETENTION_REVIEW_STATUSES = [
  'DUE',
  'IN_REVIEW',
  'BLOCKED',
  'APPROVED',
  'COMPLETED',
  'CANCELLED',
] as const;

export const ASSURANCE_EVIDENCE_STATUSES = [
  'NOT_TESTED',
  'SUBMITTED',
  'PASS',
  'FAIL',
  'BLOCKED',
  'EXPIRED',
] as const;

export const RELEASE_DECISION_STATUSES = [
  'BLOCKED',
  'APPROVED',
  'REVOKED',
] as const;

export type DataSubjectRequestType =
  (typeof DATA_SUBJECT_REQUEST_TYPES)[number];
export type DataSubjectRequestStatus =
  (typeof DATA_SUBJECT_REQUEST_STATUSES)[number];
export type IdentityProofStatus = (typeof IDENTITY_PROOF_STATUSES)[number];
export type PrivacyIncidentSeverity =
  (typeof PRIVACY_INCIDENT_SEVERITIES)[number];
export type PrivacyIncidentStatus = (typeof PRIVACY_INCIDENT_STATUSES)[number];
export type BreachNotificationDecision =
  (typeof BREACH_NOTIFICATION_DECISIONS)[number];
export type RetentionAction = (typeof RETENTION_ACTIONS)[number];
export type RetentionReviewStatus = (typeof RETENTION_REVIEW_STATUSES)[number];
export type AssuranceEvidenceStatus =
  (typeof ASSURANCE_EVIDENCE_STATUSES)[number];
export type ReleaseDecisionStatus = (typeof RELEASE_DECISION_STATUSES)[number];
