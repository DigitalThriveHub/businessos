export const CASE_TASK_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'BLOCKED',
  'COMPLETED',
  'CANCELLED',
] as const;
export type CaseTaskStatus = (typeof CASE_TASK_STATUSES)[number];

export const CASE_TASK_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type CaseTaskPriority = (typeof CASE_TASK_PRIORITIES)[number];

export const MATTER_DEADLINE_TYPES = [
  'INTERNAL',
  'CLIENT',
  'STATUTORY',
  'COURT',
  'TRIBUNAL',
  'REGULATORY',
  'OTHER',
] as const;
export type MatterDeadlineType = (typeof MATTER_DEADLINE_TYPES)[number];

export const MATTER_DEADLINE_STATUSES = [
  'OPEN',
  'SATISFIED',
  'MISSED',
  'CANCELLED',
] as const;
export type MatterDeadlineStatus = (typeof MATTER_DEADLINE_STATUSES)[number];

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
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_SECURITY_CLASSIFICATIONS = [
  'INTERNAL',
  'CONFIDENTIAL',
  'RESTRICTED',
  'LEGALLY_PRIVILEGED',
] as const;
export type DocumentSecurityClassification =
  (typeof DOCUMENT_SECURITY_CLASSIFICATIONS)[number];

export const DOCUMENT_STATUSES = [
  'PENDING_UPLOAD',
  'PENDING_SCAN',
  'AVAILABLE',
  'QUARANTINED',
  'SUPERSEDED',
  'ARCHIVED',
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const DOCUMENT_SCAN_STATUSES = [
  'NOT_SCANNED',
  'PENDING',
  'CLEAN',
  'INFECTED',
  'ERROR',
] as const;
export type DocumentScanStatus = (typeof DOCUMENT_SCAN_STATUSES)[number];

export const DOCUMENT_REQUEST_STATUSES = [
  'DRAFT',
  'SENT',
  'PARTIALLY_RECEIVED',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type DocumentRequestStatus = (typeof DOCUMENT_REQUEST_STATUSES)[number];

export const MANAGED_DOCUMENT_REQUEST_STATUSES = [
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type ManagedDocumentRequestStatus =
  (typeof MANAGED_DOCUMENT_REQUEST_STATUSES)[number];

export const DOCUMENT_REQUEST_ITEM_STATUSES = [
  'REQUESTED',
  'RECEIVED',
  'ACCEPTED',
  'REJECTED',
  'WAIVED',
] as const;
export type DocumentRequestItemStatus =
  (typeof DOCUMENT_REQUEST_ITEM_STATUSES)[number];

export interface MatterOperationHeaderView {
  id: string;
  matterNumber: string;
  title: string;
  serviceType: string;
  status: string;
  priority: string;
  primaryClientId: string;
  primaryClientName: string;
}

export interface OrganisationMemberOptionView {
  id: string;
  label: string;
}

export interface MatterTaskView {
  id: string;
  title: string;
  description: string | null;
  status: CaseTaskStatus;
  priority: CaseTaskPriority;
  assignedToUserId: string | null;
  assignedToName: string | null;
  dueAt: string | null;
  reminderAt: string | null;
  blockedReason: string | null;
  completionNote: string | null;
  completedAt: string | null;
  cancellationReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface MatterDeadlineView {
  id: string;
  title: string;
  description: string | null;
  deadlineType: MatterDeadlineType;
  status: MatterDeadlineStatus;
  dueAt: string;
  timezone: string;
  isCritical: boolean;
  ownerUserId: string | null;
  ownerName: string | null;
  sourceReference: string | null;
  satisfactionNote: string | null;
  missedReason: string | null;
  cancellationReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentRequestItemView {
  id: string;
  category: DocumentCategory;
  title: string;
  description: string | null;
  isRequired: boolean;
  status: DocumentRequestItemStatus;
  statusReason: string | null;
}

export interface DocumentRequestView {
  id: string;
  recipientClientId: string | null;
  recipientClientName: string | null;
  title: string;
  message: string | null;
  status: DocumentRequestStatus;
  dueAt: string | null;
  sentAt: string | null;
  completedAt: string | null;
  statusReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  items: DocumentRequestItemView[];
}

export interface MatterDocumentVersionView {
  id: string;
  versionNumber: number;
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
  sha256Hex: string;
  storageBucket: string;
  storagePath: string;
  status: DocumentStatus;
  scanStatus: DocumentScanStatus;
  uploadedAt: string | null;
  scanCompletedAt: string | null;
}

export interface MatterDocumentView {
  id: string;
  requestItemId: string | null;
  title: string;
  category: DocumentCategory;
  securityClassification: DocumentSecurityClassification;
  status: DocumentStatus;
  clientVisible: boolean;
  retentionReviewAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  currentVersion: MatterDocumentVersionView | null;
  pendingVersion: MatterDocumentVersionView | null;
}

export interface MatterTimelineEventView {
  id: string;
  eventType: string;
  sourceType: string;
  sourceId: string | null;
  summary: string;
  details: Record<string, unknown> | null;
  actorType: 'USER' | 'AI_AGENT' | 'SERVICE' | 'SUPPORT' | 'SYSTEM' | 'ANONYMOUS';
  actorUserId: string | null;
  actorIdentifier: string | null;
  actorName: string;
  occurredAt: string;
}

export interface MatterOperationsView {
  matter: MatterOperationHeaderView;
  members: OrganisationMemberOptionView[];
  tasks: MatterTaskView[];
  deadlines: MatterDeadlineView[];
  documentRequests: DocumentRequestView[];
  documents: MatterDocumentView[];
  timeline: MatterTimelineEventView[];
}

export interface DocumentUploadRegistrationView {
  documentId: string;
  versionId: string;
  storageBucket: string;
  storagePath: string;
  expectedContentType: string;
  expectedSizeBytes: number;
  status: 'PENDING_UPLOAD';
}

export interface DocumentProcessingView {
  documentId: string;
  versionId: string;
  documentStatus: DocumentStatus;
  scanStatus: DocumentScanStatus;
}