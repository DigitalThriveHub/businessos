import type {
  AgentAuthorityLevel,
  KpiDirection,
  KpiFrequency,
  KpiValueType,
  PermissionDataScope,
} from '../generated/prisma/enums';

export interface WorkforceDepartmentView {
  id: string;
  parentId: string | null;
  name: string;
  code: string | null;
  description: string | null;
  isActive: boolean;
  updatedAt: string;
}

export interface WorkforceTeamView {
  id: string;
  departmentId: string | null;
  name: string;
  code: string | null;
  description: string | null;
  isActive: boolean;
  updatedAt: string;
}

export interface JobProfileDutyView {
  id: string;
  code: string;
  title: string;
  description: string;
  position: number;
  isCritical: boolean;
  requiresEvidence: boolean;
  isActive: boolean;
  updatedAt: string;
}

export interface JobProfileKpiView {
  id: string;
  kpiDefinitionId: string;
  targetValue: string | null;
  minimumValue: string | null;
  maximumValue: string | null;
  weightPercent: string;
  startsAt: string;
  endsAt: string | null;
  updatedAt: string;
}

export interface JobProfileView {
  id: string;
  departmentId: string | null;
  key: string;
  name: string;
  description: string | null;
  purpose: string | null;
  version: number;
  isManagerial: boolean;
  isActive: boolean;
  updatedAt: string;
  duties: JobProfileDutyView[];
  kpis: JobProfileKpiView[];
}

export interface KpiDefinitionView {
  id: string;
  departmentId: string | null;
  key: string;
  name: string;
  description: string;
  valueType: KpiValueType;
  direction: KpiDirection;
  frequency: KpiFrequency;
  unitLabel: string | null;
  currencyCode: string | null;
  measurementSource: string;
  isActive: boolean;
  updatedAt: string;
}

export interface AgentPolicyView {
  id: string;
  toolKey: string;
  requiredPermissionKey: string;
  authorityLevel: AgentAuthorityLevel;
  maximumDataScope: PermissionDataScope;
  requiresApproval: boolean;
  requiresMfa: boolean;
  maxActionsPerRun: number;
  configuration: Record<string, unknown>;
  isActive: boolean;
  updatedAt: string;
}

export interface AgentProfileView {
  id: string;
  departmentId: string | null;
  key: string;
  name: string;
  description: string;
  behaviourInstructions: string;
  authorityCeiling: AgentAuthorityLevel;
  requiresHumanReview: boolean;
  version: number;
  isActive: boolean;
  updatedAt: string;
  policies: AgentPolicyView[];
}

export interface AiPermissionOptionView {
  key: string;
  name: string;
  description: string | null;
  resource: string;
  action: string;
  dataScope: PermissionDataScope | null;
  requiresMfa: boolean;
}

export interface WorkforceConfigurationSnapshot {
  organisationId: string;
  generatedAt: string;
  departments: WorkforceDepartmentView[];
  teams: WorkforceTeamView[];
  jobProfiles: JobProfileView[];
  kpiDefinitions: KpiDefinitionView[];
  agentProfiles: AgentProfileView[];
  aiPermissions: AiPermissionOptionView[];
}

export type WorkforceConfigurationResource =
  | 'department'
  | 'team'
  | 'job_profile'
  | 'job_profile_duty'
  | 'kpi_definition'
  | 'job_profile_kpi'
  | 'agent_profile'
  | 'agent_policy';

export interface WorkforceConfigurationMutationResult {
  resource: WorkforceConfigurationResource;
  id: string;
  version: number | null;
  updatedAt: string;
}
