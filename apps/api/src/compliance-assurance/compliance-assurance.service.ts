import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import type { OrganisationAccessContext } from '../auth/request-security-context';
import { RlsTransactionService } from '../database/rls-transaction.service';
import type {
  CreateDataSubjectRequestDto,
  CreateLegalHoldDto,
  CreatePrivacyIncidentDto,
  CreateRetentionReviewDto,
  DecideProductionReleaseDto,
  DecideRetentionReviewDto,
  ExtendDataSubjectRequestDto,
  RecordAssuranceEvidenceDto,
  ReleaseLegalHoldDto,
  ReviewAssuranceEvidenceDto,
  TransitionDataSubjectRequestDto,
  UpdatePrivacyIncidentDto,
  UpsertRetentionPolicyDto,
} from './dto/compliance-assurance.dto';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function postgresCode(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number): string | undefined => {
    if (!isRecord(value) || depth > 7 || seen.has(value)) return undefined;
    seen.add(value);
    for (const key of ['originalCode', 'sqlState', 'sqlstate', 'code']) {
      const candidate = value[key];
      if (typeof candidate === 'string' && /^[0-9A-Z]{5}$/.test(candidate)) {
        return candidate;
      }
    }
    for (const key of [
      'cause',
      'meta',
      'driverAdapterError',
      'originalError',
      'error',
    ]) {
      const candidate = visit(value[key], depth + 1);
      if (candidate) return candidate;
    }
    return undefined;
  };
  return visit(error, 0);
}

@Injectable()
export class ComplianceAssuranceService {
  private readonly logger = new Logger(ComplianceAssuranceService.name);

  constructor(private readonly rls: RlsTransactionService) {}

  async getDashboard(context: Readonly<OrganisationAccessContext>) {
    return this.runSafely('dashboard.read', async () => {
      const rows = await this.run<{ dashboard: unknown }[]>(
        context,
        (tx) =>
          tx.$queryRaw<
            { dashboard: unknown }[]
          >`SELECT private.get_compliance_assurance_dashboard() AS dashboard`,
      );
      return this.requireObject(rows, 'dashboard', 'Compliance assurance');
    });
  }

  async createDataSubjectRequest(
    dto: CreateDataSubjectRequestDto,
    context: Readonly<OrganisationAccessContext>,
  ) {
    if (!dto.subjectEmail && !dto.subjectPhone && !dto.clientId) {
      throw new BadRequestException(
        'Provide an email address, telephone number or linked client.',
      );
    }
    return this.execute(
      context,
      'rights.create',
      (tx) =>
        tx.$queryRaw<Array<{ result: unknown }>>`
        SELECT private.create_data_subject_request(
          ${dto.requestType}::public.data_subject_request_type,
          ${dto.subjectName}, ${dto.subjectEmail ?? null},
          ${dto.subjectPhone ?? null}, ${dto.clientId ?? null}::uuid,
          ${dto.receivedAt ?? null}::timestamptz,
          ${dto.requestDetails}, ${dto.ownerUserId ?? null}::uuid
        ) AS result
      `,
    );
  }

  async transitionDataSubjectRequest(
    requestId: string,
    dto: TransitionDataSubjectRequestDto,
    context: Readonly<OrganisationAccessContext>,
  ) {
    return this.execute(
      context,
      'rights.transition',
      (tx) =>
        tx.$queryRaw<Array<{ result: unknown }>>`
        SELECT private.transition_data_subject_request(
          ${requestId}::uuid,
          ${dto.status}::public.data_subject_request_status,
          ${dto.identityStatus ?? null}::public.identity_proof_status,
          ${dto.note}, ${dto.evidenceReference ?? null},
          ${dto.responseReference ?? null}, ${dto.expectedVersion}
        ) AS result
      `,
    );
  }

  async buildDataSubjectExport(
    requestId: string,
    context: Readonly<OrganisationAccessContext>,
  ) {
    return this.execute(
      context,
      'rights.export_candidate',
      (tx) =>
        tx.$queryRaw<Array<{ result: unknown }>>`
        SELECT private.build_data_subject_export_candidate(
          ${requestId}::uuid
        ) AS result
      `,
    );
  }

  async extendDataSubjectRequest(
    requestId: string,
    dto: ExtendDataSubjectRequestDto,
    context: Readonly<OrganisationAccessContext>,
  ) {
    return this.execute(
      context,
      'rights.extend_deadline',
      (tx) =>
        tx.$queryRaw<Array<{ result: unknown }>>`
        SELECT private.extend_data_subject_request(
          ${requestId}::uuid, ${dto.extendedDueAt}::timestamptz,
          ${dto.reason}, ${dto.notificationReference}, ${dto.expectedVersion}
        ) AS result
      `,
    );
  }

  async createPrivacyIncident(
    dto: CreatePrivacyIncidentDto,
    context: Readonly<OrganisationAccessContext>,
  ) {
    if (new Date(dto.discoveredAt).getTime() > Date.now() + 60_000) {
      throw new BadRequestException('Discovery time cannot be in the future.');
    }
    return this.execute(
      context,
      'incidents.create',
      (tx) =>
        tx.$queryRaw<Array<{ result: unknown }>>`
        SELECT private.create_privacy_incident(
          ${dto.title}, ${dto.description},
          ${dto.severity}::public.privacy_incident_severity,
          ${dto.personalDataBreach}, ${dto.discoveredAt}::timestamptz,
          ${dto.dataCategories}::text[], ${dto.approximatePeopleAffected},
          ${dto.ownerUserId ?? null}::uuid
        ) AS result
      `,
    );
  }

  async updatePrivacyIncident(
    incidentId: string,
    dto: UpdatePrivacyIncidentDto,
    context: Readonly<OrganisationAccessContext>,
  ) {
    return this.execute(
      context,
      'incidents.update',
      (tx) =>
        tx.$queryRaw<Array<{ result: unknown }>>`
        SELECT private.update_privacy_incident(
          ${incidentId}::uuid,
          ${dto.status}::public.privacy_incident_status,
          ${dto.severity}::public.privacy_incident_severity,
          ${dto.personalDataBreach},
          ${dto.notificationDecision}::public.breach_notification_decision,
          ${dto.containedAt ?? null}::timestamptz,
          ${dto.riskAssessment}, ${dto.resolution ?? null},
          ${dto.icoReference ?? null},
          ${dto.subjectNotificationEvidence ?? null},
          ${dto.eventNote}, ${dto.evidenceReference ?? null},
          ${dto.expectedVersion}
        ) AS result
      `,
    );
  }

  async createLegalHold(
    dto: CreateLegalHoldDto,
    context: Readonly<OrganisationAccessContext>,
  ) {
    if (dto.scopeType !== 'ORGANISATION' && !dto.scopeId) {
      throw new BadRequestException(
        'A scope record is required for this legal hold.',
      );
    }
    if (dto.scopeType === 'ORGANISATION' && dto.scopeId) {
      throw new BadRequestException(
        'Organisation-wide legal holds must not include a scope record.',
      );
    }
    return this.execute(
      context,
      'retention.hold.create',
      (tx) =>
        tx.$queryRaw<Array<{ result: unknown }>>`
        SELECT private.create_legal_hold(
          ${dto.scopeType}, ${dto.scopeId ?? null}::uuid,
          ${dto.reason}, ${dto.startsAt}::timestamptz,
          ${dto.expiresAt ?? null}::timestamptz
        ) AS result
      `,
    );
  }

  async releaseLegalHold(
    holdId: string,
    dto: ReleaseLegalHoldDto,
    context: Readonly<OrganisationAccessContext>,
  ) {
    return this.execute(
      context,
      'retention.hold.release',
      (tx) =>
        tx.$queryRaw<Array<{ result: unknown }>>`
        SELECT private.release_legal_hold(
          ${holdId}::uuid, ${dto.releaseReason}, ${dto.expectedVersion}
        ) AS result
      `,
    );
  }

  async upsertRetentionPolicy(
    dto: UpsertRetentionPolicyDto,
    context: Readonly<OrganisationAccessContext>,
  ) {
    return this.execute(
      context,
      'retention.policy.upsert',
      (tx) =>
        tx.$queryRaw<Array<{ result: unknown }>>`
        SELECT private.upsert_retention_policy(
          ${dto.policyKey}, ${dto.name}, ${dto.resourceType},
          ${dto.triggerEvent}, ${dto.retentionDays},
          ${dto.action}::public.retention_action, ${dto.lawfulReason},
          ${dto.isActive}, ${dto.expectedVersion ?? null}
        ) AS result
      `,
    );
  }

  async createRetentionReview(
    dto: CreateRetentionReviewDto,
    context: Readonly<OrganisationAccessContext>,
  ) {
    return this.execute(
      context,
      'retention.review.create',
      (tx) =>
        tx.$queryRaw<Array<{ result: unknown }>>`
        SELECT private.create_retention_review(
          ${dto.resourceType}, ${dto.resourceId}::uuid,
          ${dto.policyId}::uuid, ${dto.dueAt}::timestamptz,
          ${dto.ownerUserId ?? null}::uuid
        ) AS result
      `,
    );
  }

  async decideRetentionReview(
    reviewId: string,
    dto: DecideRetentionReviewDto,
    context: Readonly<OrganisationAccessContext>,
  ) {
    return this.execute(
      context,
      'retention.review.decide',
      (tx) =>
        tx.$queryRaw<Array<{ result: unknown }>>`
        SELECT private.decide_retention_review(
          ${reviewId}::uuid,
          ${dto.status}::public.retention_review_status,
          ${dto.decision}::public.retention_action,
          ${dto.notes}, ${dto.completionEvidenceReference ?? null},
          ${dto.expectedVersion}
        ) AS result
      `,
    );
  }

  async recordEvidence(
    dto: RecordAssuranceEvidenceDto,
    context: Readonly<OrganisationAccessContext>,
  ) {
    const testedAt = new Date(dto.testedAt).getTime();
    const expiresAt = new Date(dto.expiresAt).getTime();
    if (testedAt > Date.now() + 60_000 || expiresAt <= testedAt) {
      throw new BadRequestException(
        'Evidence dates must describe a completed test with a future expiry.',
      );
    }
    if (Object.keys(dto.scope).length === 0) {
      throw new BadRequestException(
        'Evidence must identify the environment and tested scope.',
      );
    }
    return this.execute(
      context,
      'assurance.evidence.record',
      (tx) =>
        tx.$queryRaw<Array<{ result: unknown }>>`
        SELECT private.record_assurance_evidence(
          ${dto.evidenceKey}, ${dto.title}, ${dto.category},
          ${dto.evidenceReference}, ${dto.evidenceSha256.toLowerCase()},
          ${dto.assessorName}, ${dto.assessorOrganisation ?? null},
          ${JSON.stringify(dto.scope)}::jsonb,
          ${dto.testedAt}::timestamptz, ${dto.expiresAt}::timestamptz,
          ${dto.notes}, ${dto.expectedVersion ?? null}
        ) AS result
      `,
    );
  }

  async reviewEvidence(
    evidenceId: string,
    dto: ReviewAssuranceEvidenceDto,
    context: Readonly<OrganisationAccessContext>,
  ) {
    if (!['PASS', 'FAIL', 'BLOCKED'].includes(dto.status)) {
      throw new BadRequestException(
        'Evidence review must pass, fail or block the control.',
      );
    }
    return this.execute(
      context,
      'assurance.evidence.review',
      (tx) =>
        tx.$queryRaw<Array<{ result: unknown }>>`
        SELECT private.review_assurance_evidence(
          ${evidenceId}::uuid,
          ${dto.status}::public.assurance_evidence_status,
          ${dto.reviewNote}, ${dto.expectedVersion}
        ) AS result
      `,
    );
  }

  async decideProductionRelease(
    dto: DecideProductionReleaseDto,
    context: Readonly<OrganisationAccessContext>,
  ) {
    return this.execute(
      context,
      'release.decide',
      (tx) =>
        tx.$queryRaw<Array<{ result: unknown }>>`
        SELECT private.decide_production_release(
          ${dto.releaseReference}, ${dto.environment},
          ${dto.decision}::public.release_decision_status,
          ${dto.rationale}, ${dto.changeReference ?? null}
        ) AS result
      `,
    );
  }

  private run<T>(
    context: Readonly<OrganisationAccessContext>,
    work: Parameters<RlsTransactionService['run']>[1],
  ): Promise<T> {
    return this.rls.run(
      {
        userId: context.userId,
        organisationId: context.organisationId,
        aal: context.aal,
      },
      work,
    ) as Promise<T>;
  }

  private async execute(
    context: Readonly<OrganisationAccessContext>,
    operation: string,
    work: Parameters<RlsTransactionService['run']>[1],
  ) {
    return this.runSafely(operation, async () => {
      const rows = await this.run<Array<{ result: unknown }>>(context, work);
      return this.requireObject(rows, 'result', 'Compliance mutation');
    });
  }

  private requireObject(
    rows: Array<Record<string, unknown>>,
    key: string,
    subject: string,
  ): JsonRecord {
    const value = rows[0]?.[key];
    if (rows.length !== 1 || !isRecord(value)) {
      throw new InternalServerErrorException(
        `${subject} returned an invalid response.`,
      );
    }
    return value;
  }

  private async runSafely<T>(
    operation: string,
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      return await work();
    } catch (error: unknown) {
      if (
        error instanceof BadRequestException ||
        error instanceof ForbiddenException ||
        error instanceof NotFoundException ||
        error instanceof ConflictException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      const code = postgresCode(error);
      if (code === '42501') {
        throw new ForbiddenException(
          'AAL2 and the required compliance authority are required.',
        );
      }
      if (code === 'P0002') {
        throw new NotFoundException('The compliance record was not found.');
      }
      if (['40001', '23505', '23P01', '55000'].includes(code ?? '')) {
        throw new ConflictException(
          'The record changed or a governance control blocks this action. Refresh before retrying.',
        );
      }
      if (['22007', '22023', '23514'].includes(code ?? '')) {
        throw new BadRequestException(
          'The submitted compliance information is invalid or incomplete.',
        );
      }
      if (code === '57014' || code === '08006') {
        throw new ServiceUnavailableException(
          'The compliance service is temporarily unavailable. No change was confirmed.',
        );
      }
      this.logger.error(
        `Compliance assurance operation failed; operation=${operation}; databaseCode=${code ?? 'unknown'}; errorType=${error instanceof Error ? error.name : typeof error}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException(
        'The compliance assurance service is temporarily unavailable. No change was confirmed.',
      );
    }
  }
}
