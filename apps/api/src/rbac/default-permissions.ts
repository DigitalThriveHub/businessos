export const DEFAULT_PERMISSION_KEYS = [
  // Organisation administration
  'organisation.read',
  'organisation.update',

  // Staff and membership administration
  'members.read',
  'members.update',
  'members.suspend',
  'members.roles.manage',

  // Staff invitation lifecycle
  'invitations.read',
  'invitations.create',
  'invitations.revoke',

  // Enquiries workflow
  'enquiries.create',
  'enquiries.read',
  'enquiries.read_all',
  'enquiries.update',
  'enquiries.assign',
  'enquiries.convert',
  'enquiries.close',
  'enquiries.delete',

  // Organisation operating model and workforce governance
  'workforce.read',
  'workforce.manage',
  'job_profiles.read',
  'job_profiles.manage',
  'kpis.read',
  'kpis.manage',
  'agent_profiles.read',
  'agent_profiles.manage',
  'agent_assignments.manage',
  'onboarding.manage',

  // Client lifecycle
  'clients.create',
  'clients.read',
  'clients.read_all',
  'clients.update',
  'clients.update_all',
  'clients.archive',

  // Matter lifecycle, assignment, parties and compliance
  'matters.create',
  'matters.read',
  'matters.read_all',
  'matters.update',
  'matters.update_all',
  'matters.assign',
  'matters.status.manage',
  'matters.compliance.manage',
  'matters.parties.manage',
  'matters.archive',

  // Matter tasks and controlled deadline operations
  'tasks.read',
  'tasks.create',
  'tasks.update',
  'tasks.assign',
  'tasks.complete',
  'deadlines.read',
  'deadlines.create',
  'deadlines.update',
  'deadlines.assign',
  'deadlines.manage',

  // Private document vault and requests
  'documents.read',
  'documents.upload',
  'documents.classification.manage',
  'documents.restricted.read',
  'documents.privileged.read',
  'documents.archive',
  'document_requests.read',
  'document_requests.create',
  'document_requests.send',
  'document_requests.manage',
  'matter_timeline.read',

  // Deterministic workflow, SLA, escalation and approval controls
  'automation.read',
  'automation.manage',
  'work_items.complete',
  'sla.read',
  'sla.manage',
  'approvals.read',
  'approvals.request',
  'approvals.decide',
  'escalations.read',

  // Client portal, unified communications and delivery governance
  'communications.read',
  'communications.send',
  'communications.manage',
  'communications.delivery.read',
  'communication_templates.read',
  'communication_templates.manage',
  'communication_reminders.manage',
  'portal_access.read',
  'portal_access.manage',
  'portal_updates.publish',

  // UK-ready billing, payment and accounting evidence
  'finance.read',
  'finance.settings.manage',
  'invoices.create',
  'invoices.issue',
  'invoices.void',
  'payments.record',
  'payments.refund',
  'ledger.read',
] as const;

export type DefaultPermissionKey = (typeof DEFAULT_PERMISSION_KEYS)[number];
