export type AutomationSubjectType = 'ENQUIRY' | 'CLIENT' | 'MATTER';

export interface AutomationSummaryView {
  readyWorkItems: number;
  atRiskSlas: number;
  breachedSlas: number;
  pendingApprovals: number;
  openEscalations: number;
}

export interface AutomationWorkItemView {
  id: string;
  workflowRunId: string;
  workflowName: string;
  actionKey: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  ownerUserId: string | null;
  ownerName: string | null;
  dueAt: string | null;
  version: number;
  subjectType: AutomationSubjectType;
  subjectId: string;
  subjectLabel: string;
}

export interface SlaInstanceView {
  id: string;
  policyName: string;
  status: string;
  ownerUserId: string | null;
  ownerName: string | null;
  warningAt: string;
  dueAt: string;
  atRiskAt: string | null;
  breachedAt: string | null;
  version: number;
  subjectType: AutomationSubjectType;
  subjectId: string;
  subjectLabel: string;
}

export interface EscalationView {
  id: string;
  level: number;
  actionKey: string;
  status: string;
  occurredAt: string;
  policyName: string;
  subjectType: AutomationSubjectType;
  subjectId: string;
  subjectLabel: string;
}

export interface ApprovalView {
  id: string;
  title: string;
  summary: string;
  actionKey: string;
  riskLevel: string;
  status: string;
  requestedByName: string | null;
  approverName: string | null;
  expiresAt: string;
  decidedAt: string | null;
  version: number;
  subjectType: AutomationSubjectType;
  subjectId: string;
  subjectLabel: string;
}

export interface SlaPolicyView {
  id: string;
  key: string;
  name: string;
  description: string;
  targetSeconds: number;
  warningSeconds: number;
  timezone: string;
  isActive: boolean;
  version: number;
}

export interface AutomationControlView {
  generatedAt: string;
  summary: AutomationSummaryView;
  workItems: AutomationWorkItemView[];
  slas: SlaInstanceView[];
  escalations: EscalationView[];
  approvals: ApprovalView[];
  policies: SlaPolicyView[];
}

export interface CompletedWorkItemView {
  actionId: string;
  workflowRunId: string;
  actionStatus: string;
  runStatus: string;
  actionVersion: number;
  completedAt: string;
}

export interface ApprovalDecisionView {
  approvalRequestId: string;
  approvalStatus: string;
  approvalVersion: number;
  decisionId: string;
  decidedAt: string;
}
