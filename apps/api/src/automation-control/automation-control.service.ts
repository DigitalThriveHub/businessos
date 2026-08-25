import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import type { OrganisationAccessContext } from '../auth/request-security-context';
import { RlsTransactionService } from '../database/rls-transaction.service';
import type {
  CompleteWorkflowActionDto,
  CreateApprovalRequestDto,
  DecideApprovalRequestDto,
  UpdateSlaPolicyDto,
} from './dto/automation-control.dto';
import type {
  ApprovalDecisionView,
  ApprovalView,
  AutomationControlView,
  AutomationSummaryView,
  AutomationWorkItemView,
  CompletedWorkItemView,
  EscalationView,
  SlaInstanceView,
  SlaPolicyView,
} from './automation-control.types';

type DatabaseDate = Date | string;
type NullableDatabaseDate = DatabaseDate | null;

interface SummaryRow {
  readyWorkItems: bigint | number;
  atRiskSlas: bigint | number;
  breachedSlas: bigint | number;
  pendingApprovals: bigint | number;
  openEscalations: bigint | number;
}

interface WorkItemRow extends Omit<AutomationWorkItemView, 'dueAt'> {
  dueAt: NullableDatabaseDate;
}

interface SlaRow extends Omit<
  SlaInstanceView,
  'warningAt' | 'dueAt' | 'atRiskAt' | 'breachedAt'
> {
  warningAt: DatabaseDate;
  dueAt: DatabaseDate;
  atRiskAt: NullableDatabaseDate;
  breachedAt: NullableDatabaseDate;
}

interface EscalationRow extends Omit<EscalationView, 'occurredAt'> {
  occurredAt: DatabaseDate;
}

interface ApprovalRow extends Omit<ApprovalView, 'expiresAt' | 'decidedAt'> {
  expiresAt: DatabaseDate;
  decidedAt: NullableDatabaseDate;
}

interface CompletedActionRow extends Omit<
  CompletedWorkItemView,
  'completedAt'
> {
  completedAt: DatabaseDate;
}

interface ApprovalDecisionRow extends Omit<ApprovalDecisionView, 'decidedAt'> {
  decidedAt: DatabaseDate;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function databaseCode(error: unknown): string | null {
  if (!isRecord(error)) return null;
  if (isRecord(error.meta) && typeof error.meta.code === 'string') {
    return error.meta.code;
  }
  return typeof error.code === 'string' ? error.code : null;
}

function iso(value: DatabaseDate): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function nullableIso(value: NullableDatabaseDate): string | null {
  return value === null ? null : iso(value);
}

function summaryView(row: SummaryRow | undefined): AutomationSummaryView {
  return {
    readyWorkItems: Number(row?.readyWorkItems ?? 0),
    atRiskSlas: Number(row?.atRiskSlas ?? 0),
    breachedSlas: Number(row?.breachedSlas ?? 0),
    pendingApprovals: Number(row?.pendingApprovals ?? 0),
    openEscalations: Number(row?.openEscalations ?? 0),
  };
}

@Injectable()
export class AutomationControlService {
  private readonly logger = new Logger(AutomationControlService.name);

  constructor(private readonly rls: RlsTransactionService) {}

  getControlTower(
    context: Readonly<OrganisationAccessContext>,
  ): Promise<AutomationControlView> {
    return this.runSafely('control.read', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const [summary] = await transaction.$queryRaw<SummaryRow[]>`
          SELECT
            (
              SELECT pg_catalog.count(*)
              FROM public.workflow_actions AS work_action
              WHERE work_action.organisation_id = ${context.organisationId}::uuid
                AND work_action.action_type = 'HUMAN_TASK'
                AND work_action.status IN ('READY', 'RUNNING', 'WAITING')
            ) AS "readyWorkItems",
            (
              SELECT pg_catalog.count(*)
              FROM public.sla_instances AS instance
              WHERE instance.organisation_id = ${context.organisationId}::uuid
                AND instance.status = 'AT_RISK'
            ) AS "atRiskSlas",
            (
              SELECT pg_catalog.count(*)
              FROM public.sla_instances AS instance
              WHERE instance.organisation_id = ${context.organisationId}::uuid
                AND instance.status = 'BREACHED'
            ) AS "breachedSlas",
            (
              SELECT pg_catalog.count(*)
              FROM public.approval_requests AS approval
              WHERE approval.organisation_id = ${context.organisationId}::uuid
                AND approval.status = 'PENDING'
            ) AS "pendingApprovals",
            (
              SELECT pg_catalog.count(*)
              FROM public.escalation_events AS escalation
              WHERE escalation.organisation_id = ${context.organisationId}::uuid
                AND escalation.status <> 'RESOLVED'
            ) AS "openEscalations"
        `;

        const workItemRows = await transaction.$queryRaw<WorkItemRow[]>`
            SELECT
              work_action.id,
              work_action.workflow_run_id AS "workflowRunId",
              definition.name AS "workflowName",
              work_action.action_key AS "actionKey",
              work_action.title,
              work_action.description,
              work_action.status::text AS status,
              work_action.priority::text AS priority,
              work_action.owner_user_id AS "ownerUserId",
              COALESCE(
                NULLIF(pg_catalog.btrim(owner_profile.display_name), ''),
                NULLIF(
                  pg_catalog.btrim(
                    pg_catalog.concat_ws(
                      ' ',
                      owner_profile.first_name,
                      owner_profile.last_name
                    )
                  ),
                  ''
                ),
                owner_profile.email
              ) AS "ownerName",
              work_action.due_at AS "dueAt",
              work_action.version,
              workflow_run.subject_type::text AS "subjectType",
              workflow_run.subject_id AS "subjectId",
              COALESCE(
                CASE workflow_run.subject_type
                  WHEN 'ENQUIRY' THEN (
                    SELECT COALESCE(
                      NULLIF(
                        pg_catalog.btrim(
                          pg_catalog.concat_ws(
                            ' ',
                            enquiry.first_name,
                            enquiry.last_name
                          )
                        ),
                        ''
                      ),
                      enquiry.email,
                      'Enquiry'
                    )
                    FROM public.enquiries AS enquiry
                    WHERE enquiry.id = workflow_run.subject_id
                      AND enquiry.organisation_id =
                        workflow_run.organisation_id
                      AND enquiry.deleted_at IS NULL
                  )
                  WHEN 'CLIENT' THEN (
                    SELECT client.display_name
                    FROM public.clients AS client
                    WHERE client.id = workflow_run.subject_id
                      AND client.organisation_id =
                        workflow_run.organisation_id
                      AND client.deleted_at IS NULL
                  )
                  WHEN 'MATTER' THEN (
                    SELECT matter.title
                    FROM public.matters AS matter
                    WHERE matter.id = workflow_run.subject_id
                      AND matter.organisation_id =
                        workflow_run.organisation_id
                      AND matter.deleted_at IS NULL
                  )
                END,
                'Business record'
              ) AS "subjectLabel"
            FROM public.workflow_actions AS work_action
            JOIN public.workflow_runs AS workflow_run
              ON workflow_run.id = work_action.workflow_run_id
             AND workflow_run.organisation_id =
               work_action.organisation_id
            JOIN public.workflow_definitions AS definition
              ON definition.id = workflow_run.workflow_definition_id
             AND definition.organisation_id =
               workflow_run.organisation_id
            LEFT JOIN public.user_profiles AS owner_profile
              ON owner_profile.id = work_action.owner_user_id
            WHERE work_action.organisation_id =
              ${context.organisationId}::uuid
              AND work_action.action_type = 'HUMAN_TASK'
              AND work_action.status IN ('READY', 'RUNNING', 'WAITING')
            ORDER BY
              CASE work_action.priority
                WHEN 'URGENT' THEN 1
                WHEN 'HIGH' THEN 2
                WHEN 'NORMAL' THEN 3
                ELSE 4
              END,
              work_action.due_at NULLS LAST,
              work_action.created_at
            LIMIT 50
          `;

        const slaRows = await transaction.$queryRaw<SlaRow[]>`
          SELECT
            instance.id,
            policy.name AS "policyName",
            instance.status::text AS status,
            instance.owner_user_id AS "ownerUserId",
            COALESCE(
              NULLIF(pg_catalog.btrim(owner_profile.display_name), ''),
              NULLIF(
                pg_catalog.btrim(
                  pg_catalog.concat_ws(
                    ' ',
                    owner_profile.first_name,
                    owner_profile.last_name
                  )
                ),
                ''
              ),
              owner_profile.email
            ) AS "ownerName",
            instance.warning_at AS "warningAt",
            instance.due_at AS "dueAt",
            instance.at_risk_at AS "atRiskAt",
            instance.breached_at AS "breachedAt",
            instance.version,
            instance.subject_type::text AS "subjectType",
            instance.subject_id AS "subjectId",
            COALESCE(
              CASE instance.subject_type
                WHEN 'ENQUIRY' THEN (
                  SELECT COALESCE(
                    NULLIF(
                      pg_catalog.btrim(
                        pg_catalog.concat_ws(
                          ' ',
                          enquiry.first_name,
                          enquiry.last_name
                        )
                      ),
                      ''
                    ),
                    enquiry.email,
                    'Enquiry'
                  )
                  FROM public.enquiries AS enquiry
                  WHERE enquiry.id = instance.subject_id
                    AND enquiry.organisation_id =
                      instance.organisation_id
                    AND enquiry.deleted_at IS NULL
                )
                WHEN 'CLIENT' THEN (
                  SELECT client.display_name
                  FROM public.clients AS client
                  WHERE client.id = instance.subject_id
                    AND client.organisation_id =
                      instance.organisation_id
                    AND client.deleted_at IS NULL
                )
                WHEN 'MATTER' THEN (
                  SELECT matter.title
                  FROM public.matters AS matter
                  WHERE matter.id = instance.subject_id
                    AND matter.organisation_id =
                      instance.organisation_id
                    AND matter.deleted_at IS NULL
                )
              END,
              'Business record'
            ) AS "subjectLabel"
          FROM public.sla_instances AS instance
          JOIN public.sla_policies AS policy
            ON policy.id = instance.sla_policy_id
           AND policy.organisation_id = instance.organisation_id
          LEFT JOIN public.user_profiles AS owner_profile
            ON owner_profile.id = instance.owner_user_id
          WHERE instance.organisation_id =
            ${context.organisationId}::uuid
            AND instance.status IN ('ACTIVE', 'AT_RISK', 'BREACHED')
          ORDER BY instance.due_at, instance.created_at
          LIMIT 50
        `;

        const escalationRows = await transaction.$queryRaw<EscalationRow[]>`
            SELECT
              escalation.id,
              escalation.level,
              escalation.action_key AS "actionKey",
              escalation.status::text AS status,
              escalation.occurred_at AS "occurredAt",
              policy.name AS "policyName",
              instance.subject_type::text AS "subjectType",
              instance.subject_id AS "subjectId",
              COALESCE(
                CASE instance.subject_type
                  WHEN 'ENQUIRY' THEN (
                    SELECT COALESCE(
                      NULLIF(
                        pg_catalog.btrim(
                          pg_catalog.concat_ws(
                            ' ',
                            enquiry.first_name,
                            enquiry.last_name
                          )
                        ),
                        ''
                      ),
                      enquiry.email,
                      'Enquiry'
                    )
                    FROM public.enquiries AS enquiry
                    WHERE enquiry.id = instance.subject_id
                      AND enquiry.organisation_id =
                        instance.organisation_id
                      AND enquiry.deleted_at IS NULL
                  )
                  WHEN 'CLIENT' THEN (
                    SELECT client.display_name
                    FROM public.clients AS client
                    WHERE client.id = instance.subject_id
                      AND client.organisation_id =
                        instance.organisation_id
                      AND client.deleted_at IS NULL
                  )
                  WHEN 'MATTER' THEN (
                    SELECT matter.title
                    FROM public.matters AS matter
                    WHERE matter.id = instance.subject_id
                      AND matter.organisation_id =
                        instance.organisation_id
                      AND matter.deleted_at IS NULL
                  )
                END,
                'Business record'
              ) AS "subjectLabel"
            FROM public.escalation_events AS escalation
            JOIN public.sla_instances AS instance
              ON instance.id = escalation.sla_instance_id
             AND instance.organisation_id =
               escalation.organisation_id
            JOIN public.sla_policies AS policy
              ON policy.id = instance.sla_policy_id
             AND policy.organisation_id = instance.organisation_id
            WHERE escalation.organisation_id =
              ${context.organisationId}::uuid
              AND escalation.status <> 'RESOLVED'
            ORDER BY escalation.level DESC, escalation.occurred_at DESC
            LIMIT 50
          `;

        const approvalRows = await transaction.$queryRaw<ApprovalRow[]>`
            SELECT
              approval.id,
              approval.title,
              approval.summary,
              approval.action_key AS "actionKey",
              approval.risk_level::text AS "riskLevel",
              approval.status::text AS status,
              COALESCE(
                NULLIF(pg_catalog.btrim(requester.display_name), ''),
                requester.email
              ) AS "requestedByName",
              COALESCE(
                NULLIF(pg_catalog.btrim(approver.display_name), ''),
                approver.email
              ) AS "approverName",
              approval.expires_at AS "expiresAt",
              approval.decided_at AS "decidedAt",
              approval.version,
              approval.subject_type::text AS "subjectType",
              approval.subject_id AS "subjectId",
              COALESCE(
                CASE approval.subject_type
                  WHEN 'ENQUIRY' THEN (
                    SELECT COALESCE(
                      NULLIF(
                        pg_catalog.btrim(
                          pg_catalog.concat_ws(
                            ' ',
                            enquiry.first_name,
                            enquiry.last_name
                          )
                        ),
                        ''
                      ),
                      enquiry.email,
                      'Enquiry'
                    )
                    FROM public.enquiries AS enquiry
                    WHERE enquiry.id = approval.subject_id
                      AND enquiry.organisation_id =
                        approval.organisation_id
                      AND enquiry.deleted_at IS NULL
                  )
                  WHEN 'CLIENT' THEN (
                    SELECT client.display_name
                    FROM public.clients AS client
                    WHERE client.id = approval.subject_id
                      AND client.organisation_id =
                        approval.organisation_id
                      AND client.deleted_at IS NULL
                  )
                  WHEN 'MATTER' THEN (
                    SELECT matter.title
                    FROM public.matters AS matter
                    WHERE matter.id = approval.subject_id
                      AND matter.organisation_id =
                        approval.organisation_id
                      AND matter.deleted_at IS NULL
                  )
                END,
                'Business record'
              ) AS "subjectLabel"
            FROM public.approval_requests AS approval
            LEFT JOIN public.user_profiles AS requester
              ON requester.id = approval.requested_by_user_profile_id
            LEFT JOIN public.user_profiles AS approver
              ON approver.id = approval.approver_user_id
            WHERE approval.organisation_id =
              ${context.organisationId}::uuid
              AND approval.status IN ('PENDING', 'APPROVED', 'REJECTED')
            ORDER BY
              CASE approval.status WHEN 'PENDING' THEN 1 ELSE 2 END,
              approval.expires_at,
              approval.created_at DESC
            LIMIT 50
          `;

        const policies = await transaction.$queryRaw<SlaPolicyView[]>`
          SELECT
            policy.id,
            policy.key,
            policy.name,
            policy.description,
            policy.target_seconds AS "targetSeconds",
            policy.warning_seconds AS "warningSeconds",
            policy.timezone,
            policy.is_active AS "isActive",
            policy.version
          FROM public.sla_policies AS policy
          WHERE policy.organisation_id =
            ${context.organisationId}::uuid
            AND policy.deleted_at IS NULL
          ORDER BY policy.name
        `;

        return {
          generatedAt: new Date().toISOString(),
          summary: summaryView(summary),
          workItems: workItemRows.map((row) => ({
            ...row,
            dueAt: nullableIso(row.dueAt),
          })),
          slas: slaRows.map((row) => ({
            ...row,
            warningAt: iso(row.warningAt),
            dueAt: iso(row.dueAt),
            atRiskAt: nullableIso(row.atRiskAt),
            breachedAt: nullableIso(row.breachedAt),
          })),
          escalations: escalationRows.map((row) => ({
            ...row,
            occurredAt: iso(row.occurredAt),
          })),
          approvals: approvalRows.map((row) => ({
            ...row,
            expiresAt: iso(row.expiresAt),
            decidedAt: nullableIso(row.decidedAt),
          })),
          policies,
        };
      }),
    );
  }

  completeWorkItem(
    actionId: string,
    dto: CompleteWorkflowActionDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<CompletedWorkItemView> {
    return this.runSafely('work-item.complete', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const [row] = await transaction.$queryRaw<CompletedActionRow[]>`
          SELECT
            action_id AS "actionId",
            workflow_run_id AS "workflowRunId",
            action_status::text AS "actionStatus",
            run_status::text AS "runStatus",
            action_version AS "actionVersion",
            completed_at AS "completedAt"
          FROM private.complete_workflow_action(
            ${actionId}::uuid,
            ${dto.expectedVersion},
            ${dto.completionNote?.trim() || null}
          )
        `;
        if (!row) {
          throw new NotFoundException('Workflow work item not found.');
        }
        return { ...row, completedAt: iso(row.completedAt) };
      }),
    );
  }

  createApproval(
    dto: CreateApprovalRequestDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<ApprovalView> {
    return this.runSafely('approval.create', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const expiresAt = new Date(dto.expiresAt);
        if (expiresAt.getTime() <= Date.now() + 60_000) {
          throw new BadRequestException(
            'Approval expiry must be at least one minute in the future.',
          );
        }
        if (dto.workflowActionId && !dto.workflowRunId) {
          throw new BadRequestException(
            'A linked approval action requires its workflow run.',
          );
        }
        if (
          dto.allowSelfApproval &&
          (dto.riskLevel === 'HIGH' || dto.riskLevel === 'CRITICAL')
        ) {
          throw new BadRequestException(
            'High-risk approval requests cannot allow self approval.',
          );
        }

        const [row] = await transaction.$queryRaw<ApprovalRow[]>`
          WITH inserted AS (
            INSERT INTO public.approval_requests (
              organisation_id, workflow_run_id, workflow_action_id,
              subject_type, subject_id, title, summary, action_key,
              risk_level, proposed_payload, status,
              requested_by_actor_type, requested_by_user_profile_id,
              approver_user_id, allow_self_approval, expires_at
            )
            VALUES (
              ${context.organisationId}::uuid,
              ${dto.workflowRunId ?? null}::uuid,
              ${dto.workflowActionId ?? null}::uuid,
              ${dto.subjectType}::public.automation_subject_type,
              ${dto.subjectId}::uuid,
              ${dto.title.trim()},
              ${dto.summary.trim()},
              ${dto.actionKey},
              ${dto.riskLevel}::public.approval_risk_level,
              ${JSON.stringify(dto.proposedPayload ?? {})}::jsonb,
              'PENDING',
              'USER',
              ${context.userId}::uuid,
              ${dto.approverUserId}::uuid,
              ${dto.allowSelfApproval ?? false},
              ${expiresAt.toISOString()}::timestamptz
            )
            RETURNING *
          )
          SELECT
            approval.id,
            approval.title,
            approval.summary,
            approval.action_key AS "actionKey",
            approval.risk_level::text AS "riskLevel",
            approval.status::text AS status,
            COALESCE(
              NULLIF(pg_catalog.btrim(requester.display_name), ''),
              requester.email
            ) AS "requestedByName",
            COALESCE(
              NULLIF(pg_catalog.btrim(approver.display_name), ''),
              approver.email
            ) AS "approverName",
            approval.expires_at AS "expiresAt",
            approval.decided_at AS "decidedAt",
            approval.version,
            approval.subject_type::text AS "subjectType",
            approval.subject_id AS "subjectId",
            'Business record' AS "subjectLabel"
          FROM inserted AS approval
          LEFT JOIN public.user_profiles AS requester
            ON requester.id = approval.requested_by_user_profile_id
          LEFT JOIN public.user_profiles AS approver
            ON approver.id = approval.approver_user_id
        `;
        if (!row) {
          throw new InternalServerErrorException(
            'Approval request could not be created.',
          );
        }

        await transaction.$executeRaw`
          INSERT INTO public.audit_events (
            id, organisation_id, actor_type, actor_user_profile_id,
            source, action, resource_type, resource_id,
            outcome, new_value, metadata
          )
          VALUES (
            pg_catalog.gen_random_uuid(),
            ${context.organisationId}::uuid,
            'USER'::public.audit_actor_type,
            ${context.userId}::uuid,
            'businessos-api',
            'approval.requested',
            'approval_request',
            ${row.id},
            'SUCCESS'::public.audit_outcome,
            ${JSON.stringify({
              status: row.status,
              riskLevel: row.riskLevel,
              expiresAt: iso(row.expiresAt),
            })}::jsonb,
            ${JSON.stringify({
              subjectType: row.subjectType,
              subjectId: row.subjectId,
              actionKey: row.actionKey,
            })}::jsonb
          )
        `;

        return {
          ...row,
          expiresAt: iso(row.expiresAt),
          decidedAt: nullableIso(row.decidedAt),
        };
      }),
    );
  }

  decideApproval(
    approvalId: string,
    dto: DecideApprovalRequestDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<ApprovalDecisionView> {
    return this.runSafely('approval.decide', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const [row] = await transaction.$queryRaw<ApprovalDecisionRow[]>`
          SELECT
            approval_request_id AS "approvalRequestId",
            approval_status::text AS "approvalStatus",
            approval_version AS "approvalVersion",
            decision_id AS "decisionId",
            decided_at AS "decidedAt"
          FROM private.decide_approval_request(
            ${approvalId}::uuid,
            ${dto.expectedVersion},
            ${dto.decision}::public.approval_decision_type,
            ${dto.reason.trim()}
          )
        `;
        if (!row) {
          throw new NotFoundException('Approval request not found.');
        }
        if (dto.decision === 'APPROVED') {
          await transaction.$queryRaw`
            SELECT private.materialise_approved_ai_draft(${approvalId}::uuid)
          `;
        }
        return { ...row, decidedAt: iso(row.decidedAt) };
      }),
    );
  }

  updateSlaPolicy(
    policyId: string,
    dto: UpdateSlaPolicyDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<SlaPolicyView> {
    return this.runSafely('sla-policy.update', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        if (
          dto.targetSeconds === undefined &&
          dto.warningSeconds === undefined &&
          dto.isActive === undefined
        ) {
          throw new BadRequestException(
            'At least one SLA policy change is required.',
          );
        }

        const [current] = await transaction.$queryRaw<SlaPolicyView[]>`
          SELECT
            policy.id,
            policy.key,
            policy.name,
            policy.description,
            policy.target_seconds AS "targetSeconds",
            policy.warning_seconds AS "warningSeconds",
            policy.timezone,
            policy.is_active AS "isActive",
            policy.version
          FROM public.sla_policies AS policy
          WHERE policy.id = ${policyId}::uuid
            AND policy.organisation_id =
              ${context.organisationId}::uuid
            AND policy.deleted_at IS NULL
          FOR UPDATE
        `;
        if (!current) {
          throw new NotFoundException('SLA policy not found.');
        }
        if (current.version !== dto.expectedVersion) {
          throw new ConflictException(
            'This SLA policy changed. Refresh before saving.',
          );
        }

        const [updated] = await transaction.$queryRaw<SlaPolicyView[]>`
          UPDATE public.sla_policies AS policy
          SET target_seconds = COALESCE(
                ${dto.targetSeconds ?? null}::integer,
                policy.target_seconds
              ),
              warning_seconds = COALESCE(
                ${dto.warningSeconds ?? null}::integer,
                policy.warning_seconds
              ),
              is_active = COALESCE(
                ${dto.isActive ?? null}::boolean,
                policy.is_active
              ),
              updated_by_user_profile_id =
                ${context.userId}::uuid,
              updated_at = pg_catalog.now(),
              version = policy.version + 1
          WHERE policy.id = ${policyId}::uuid
            AND policy.organisation_id =
              ${context.organisationId}::uuid
            AND policy.version = ${dto.expectedVersion}
            AND policy.deleted_at IS NULL
          RETURNING
            policy.id,
            policy.key,
            policy.name,
            policy.description,
            policy.target_seconds AS "targetSeconds",
            policy.warning_seconds AS "warningSeconds",
            policy.timezone,
            policy.is_active AS "isActive",
            policy.version
        `;
        if (!updated) {
          throw new ConflictException(
            'The SLA policy changed while saving. Refresh and retry.',
          );
        }

        await transaction.$executeRaw`
          INSERT INTO public.audit_events (
            id, organisation_id, actor_type, actor_user_profile_id,
            source, action, resource_type, resource_id,
            outcome, previous_value, new_value
          )
          VALUES (
            pg_catalog.gen_random_uuid(),
            ${context.organisationId}::uuid,
            'USER'::public.audit_actor_type,
            ${context.userId}::uuid,
            'businessos-api',
            'sla.policy.updated',
            'sla_policy',
            ${updated.id},
            'SUCCESS'::public.audit_outcome,
            ${JSON.stringify({
              targetSeconds: current.targetSeconds,
              warningSeconds: current.warningSeconds,
              isActive: current.isActive,
              version: current.version,
            })}::jsonb,
            ${JSON.stringify({
              targetSeconds: updated.targetSeconds,
              warningSeconds: updated.warningSeconds,
              isActive: updated.isActive,
              version: updated.version,
            })}::jsonb
          )
        `;

        return updated;
      }),
    );
  }

  private rlsContext(context: Readonly<OrganisationAccessContext>) {
    return {
      userId: context.userId,
      organisationId: context.organisationId,
      aal: context.aal,
    } as const;
  }

  private async runSafely<T>(
    operation: string,
    callback: () => Promise<T>,
  ): Promise<T> {
    try {
      return await callback();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const code = databaseCode(error);

      if (code === '42501') {
        throw new ForbiddenException(
          'This operation is not permitted, or MFA is required.',
        );
      }
      if (code === '23505' || code === 'P2002') {
        throw new ConflictException(
          'A protected workflow or approval record already exists.',
        );
      }
      if (code === '40001' || code === 'P2034') {
        throw new ConflictException(
          'The record changed during this operation. Refresh and retry.',
        );
      }
      if (code === 'P0002' || code === 'P2025') {
        throw new NotFoundException('Automation record not found.');
      }
      if (
        code === '22023' ||
        code === '23503' ||
        code === '23514' ||
        code === 'P2003' ||
        code === 'P2004'
      ) {
        throw new BadRequestException(
          'The operation conflicts with an access, timing or lifecycle control.',
        );
      }

      this.logger.error(
        `Automation-control operation failed; operation=${operation}; databaseCode=${code ?? 'unknown'}; errorType=${
          error instanceof Error ? error.name : typeof error
        }`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException(
        'The automation-control operation could not be completed.',
      );
    }
  }
}
