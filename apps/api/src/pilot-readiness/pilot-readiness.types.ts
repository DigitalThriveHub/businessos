export type PilotAcceptanceInput = {
  key: string;
  roleName: string;
  scenarioName: string;
  status: 'NOT_TESTED' | 'PASS' | 'FAIL' | 'BLOCKED';
  evidenceNote?: string;
  evidenceReference?: string;
  expectedVersion?: number;
};

export type PilotFeedbackInput = {
  affectedRole: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  title: string;
  detail: string;
  reproductionSteps: string;
};

export type PilotFeedbackResolutionInput = {
  status: 'RESOLVED' | 'ACCEPTED_RISK';
  resolution: string;
  expectedVersion: number;
};
