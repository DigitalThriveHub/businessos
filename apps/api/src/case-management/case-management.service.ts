import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import type { OrganisationAccessContext } from '../auth/request-security-context';
import { RlsTransactionService } from '../database/rls-transaction.service';
import { Prisma } from '../generated/prisma/client';
import { EnquiryStatus } from '../generated/prisma/enums';
import { assertEnquiryCanConvert } from '../enquiries/enquiry-workflow';
import {
  AddMatterPartyDto,
  ArchiveClientDto,
  CaseManagementOptionsQueryDto,
  ChangeMatterStatusDto,
  ClientQueryDto,
  ConvertEnquiryDto,
  CreateClientDto,
  CreateMatterDto,
  MatterQueryDto,
  RemoveMatterPartyDto,
  UpdateClientDto,
  UpdateMatterComplianceDto,
  UpdateMatterDto,
} from './dto/case-management.dto';
import type {
  CaseManagementOptionsView,
  ClientKind,
  ClientListView,
  ClientView,
  EnquiryConversionResult,
  MatterComplianceView,
  MatterListView,
  MatterPartyView,
  MatterStatus,
  MatterStatusHistoryView,
  MatterSummaryView,
  MatterView,
} from './case-management.types';

type Transaction = Prisma.TransactionClient;
type DatabaseDate = Date | string;
type NullableDatabaseDate = DatabaseDate | null;

interface ClientRow {
  id: string;
  organisationId: string;
  clientNumber: string;
  sourceEnquiryId: string | null;
  kind: ClientView['kind'];
  status: ClientView['status'];
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  organisationName: string | null;
  email: string | null;
  phone: string | null;
  dateOfBirth: NullableDatabaseDate;
  nationality: string | null;
  countryOfResidenceCode: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  addressCountryCode: string | null;
  preferredLanguage: string;
  preferredCommunication: ClientView['preferredCommunication'];
  processingLawfulBasis: ClientView['processingLawfulBasis'];
  privacyNoticeVersion: string | null;
  privacyNoticeAcknowledgedAt: NullableDatabaseDate;
  marketingConsent: boolean;
  marketingConsentAt: NullableDatabaseDate;
  marketingConsentSource: string | null;
  riskRating: ClientView['riskRating'];
  identityVerificationStatus: ClientView['identityVerificationStatus'];
  identityVerifiedAt: NullableDatabaseDate;
  identityVerificationExpiresAt: NullableDatabaseDate;
  assignedToUserId: string | null;
  assignedToName: string | null;
  lastContactedAt: NullableDatabaseDate;
  retentionReviewAt: NullableDatabaseDate;
  archivedAt: NullableDatabaseDate;
  archiveReason: string | null;
  version: number;
  createdAt: DatabaseDate;
  updatedAt: DatabaseDate;
  totalCount?: bigint | number;
}

interface MatterRow {
  id: string;
  organisationId: string;
  matterNumber: string;
  sourceEnquiryId: string | null;
  departmentId: string | null;
  teamId: string | null;
  assignedToUserId: string | null;
  assignedToName: string | null;
  supervisorUserId: string | null;
  supervisorName: string | null;
  title: string;
  description: string | null;
  serviceType: string;
  jurisdictionCountryCode: string | null;
  externalReference: string | null;
  status: MatterView['status'];
  priority: MatterView['priority'];
  nextActionSummary: string | null;
  nextActionAt: NullableDatabaseDate;
  criticalDeadlineAt: NullableDatabaseDate;
  targetCompletionAt: NullableDatabaseDate;
  openedAt: DatabaseDate;
  closedAt: NullableDatabaseDate;
  closureReason: string | null;
  outcome: string | null;
  archivedAt: NullableDatabaseDate;
  archiveReason: string | null;
  version: number;
  createdAt: DatabaseDate;
  updatedAt: DatabaseDate;
  primaryClientId: string;
  primaryClientName: string;
  totalCount?: bigint | number;
}

interface ComplianceRow {
  id: string;
  conflictStatus: MatterComplianceView['conflictStatus'];
  conflictReference: string | null;
  conflictCheckedAt: NullableDatabaseDate;
  conflictCheckedByUserId: string | null;
  amlStatus: MatterComplianceView['amlStatus'];
  amlReference: string | null;
  amlCheckedAt: NullableDatabaseDate;
  amlCheckedByUserId: string | null;
  clientCareStatus: MatterComplianceView['clientCareStatus'];
  clientCareSentAt: NullableDatabaseDate;
  clientCareRespondedAt: NullableDatabaseDate;
  riskRating: MatterComplianceView['riskRating'];
  riskReason: string | null;
  riskReviewedAt: NullableDatabaseDate;
  riskReviewedByUserId: string | null;
  version: number;
  updatedAt: DatabaseDate;
}

interface PartyRow {
  id: string;
  clientId: string;
  clientNumber: string;
  clientName: string;
  role: MatterPartyView['role'];
  isPrimary: boolean;
  roleDescription: string | null;
  updatedAt: DatabaseDate;
}

interface StatusHistoryRow {
  id: string;
  fromStatus: MatterStatusHistoryView['fromStatus'];
  toStatus: MatterStatusHistoryView['toStatus'];
  reason: string;
  changedByUserId: string;
  changedByName: string;
  occurredAt: DatabaseDate;
}

interface ConversionRow {
  enquiryId: string;
  clientId: string;
  matterId: string;
  idempotencyKey: string;
  clientNumber: string;
  matterNumber: string;
}

interface EnquiryForConversionRow {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  serviceType: string | null;
  status: string;
  assignedToUserId: string | null;
}

const MATTER_TRANSITIONS: Readonly<Record<MatterStatus, readonly MatterStatus[]>> = {
  INTAKE: ['CONFLICT_CHECK', 'ON_HOLD', 'CANCELLED'],
  CONFLICT_CHECK: ['CLIENT_CARE', 'ON_HOLD', 'CANCELLED'],
  CLIENT_CARE: ['AWAITING_DOCUMENTS', 'ACTIVE', 'ON_HOLD', 'CANCELLED'],
  AWAITING_DOCUMENTS: ['ACTIVE', 'ON_HOLD', 'CANCELLED'],
  ACTIVE: ['SUBMITTED', 'DECISION_RECEIVED', 'ON_HOLD', 'CLOSED', 'CANCELLED'],
  SUBMITTED: ['DECISION_RECEIVED', 'ON_HOLD', 'CANCELLED'],
  DECISION_RECEIVED: ['ACTIVE', 'ON_HOLD', 'CLOSED', 'CANCELLED'],
  ON_HOLD: [
    'CONFLICT_CHECK',
    'CLIENT_CARE',
    'AWAITING_DOCUMENTS',
    'ACTIVE',
    'SUBMITTED',
    'DECISION_RECEIVED',
    'CANCELLED',
  ],
  CLOSED: ['ARCHIVED'],
  CANCELLED: ['ARCHIVED'],
  ARCHIVED: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function databaseCode(error: unknown): string | null {
  if (!isRecord(error)) {
    return null;
  }

  return typeof error.code === 'string' ? error.code : null;
}

function iso(value: DatabaseDate): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: NullableDatabaseDate): string | null {
  return value === null ? null : iso(value);
}

function dateOnly(value: NullableDatabaseDate): string | null {
  return value === null ? null : iso(value).slice(0, 10);
}

function totalNumber(value: bigint | number | undefined): number {
  if (typeof value === 'bigint') {
    return Number(value);
  }

  return value ?? 0;
}

function displayName(input: {
  kind: ClientKind;
  firstName?: string | null;
  lastName?: string | null;
  organisationName?: string | null;
}): string {
  if (input.kind === 'ORGANISATION') {
    return input.organisationName?.trim() ?? '';
  }

  return [input.firstName, input.lastName].filter(Boolean).join(' ').trim();
}

function clientView(row: ClientRow): ClientView {
  return {
    ...row,
    dateOfBirth: dateOnly(row.dateOfBirth),
    privacyNoticeAcknowledgedAt: nullableIso(row.privacyNoticeAcknowledgedAt),
    marketingConsentAt: nullableIso(row.marketingConsentAt),
    identityVerifiedAt: nullableIso(row.identityVerifiedAt),
    identityVerificationExpiresAt: nullableIso(row.identityVerificationExpiresAt),
    lastContactedAt: nullableIso(row.lastContactedAt),
    retentionReviewAt: nullableIso(row.retentionReviewAt),
    archivedAt: nullableIso(row.archivedAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    totalCount: undefined,
  } as ClientView;
}

function matterSummary(row: MatterRow): MatterSummaryView {
  return {
    id: row.id,
    matterNumber: row.matterNumber,
    title: row.title,
    serviceType: row.serviceType,
    status: row.status,
    priority: row.priority,
    primaryClientId: row.primaryClientId,
    primaryClientName: row.primaryClientName,
    assignedToUserId: row.assignedToUserId,
    assignedToName: row.assignedToName,
    departmentId: row.departmentId,
    teamId: row.teamId,
    nextActionAt: nullableIso(row.nextActionAt),
    criticalDeadlineAt: nullableIso(row.criticalDeadlineAt),
    version: row.version,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function complianceView(row: ComplianceRow): MatterComplianceView {
  return {
    ...row,
    conflictCheckedAt: nullableIso(row.conflictCheckedAt),
    amlCheckedAt: nullableIso(row.amlCheckedAt),
    clientCareSentAt: nullableIso(row.clientCareSentAt),
    clientCareRespondedAt: nullableIso(row.clientCareRespondedAt),
    riskReviewedAt: nullableIso(row.riskReviewedAt),
    updatedAt: iso(row.updatedAt),
  };
}

@Injectable()
export class CaseManagementService {
  private readonly logger = new Logger(CaseManagementService.name);

  constructor(private readonly rls: RlsTransactionService) {}

  async getOptions(
    query: CaseManagementOptionsQueryDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<CaseManagementOptionsView> {
    return this.runSafely('options.read', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const [departments, teams, members, clients, convertibleEnquiries] =
          await Promise.all([
          transaction.$queryRaw<Array<{ id: string; label: string }>>`
            SELECT department.id, department.name AS label
            FROM public.departments AS department
            WHERE department.organisation_id = ${context.organisationId}::uuid
              AND department.is_active = true
              AND department.deleted_at IS NULL
            ORDER BY department.name ASC
          `,
          transaction.$queryRaw<
            Array<{ id: string; label: string; departmentId: string | null }>
          >`
            SELECT
              team.id,
              team.name AS label,
              team.department_id AS "departmentId"
            FROM public.teams AS team
            WHERE team.organisation_id = ${context.organisationId}::uuid
              AND team.is_active = true
              AND team.deleted_at IS NULL
            ORDER BY team.name ASC
          `,
          transaction.$queryRaw<Array<{ id: string; label: string }>>`
            SELECT
              profile.id,
              COALESCE(
                NULLIF(btrim(profile.display_name), ''),
                NULLIF(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
                profile.email
              ) AS label
            FROM public.organisation_memberships AS membership
            JOIN public.user_profiles AS profile
              ON profile.id = membership.user_profile_id
            WHERE membership.organisation_id = ${context.organisationId}::uuid
              AND membership.status = 'ACTIVE'
              AND membership.deleted_at IS NULL
              AND profile.status = 'ACTIVE'
              AND profile.deleted_at IS NULL
            ORDER BY label ASC
          `,
          transaction.$queryRaw<
            Array<{ id: string; label: string; clientNumber: string }>
          >`
            SELECT
              client.id,
              client.display_name AS label,
              client.client_number AS "clientNumber"
            FROM public.clients AS client
            WHERE client.organisation_id = ${context.organisationId}::uuid
              AND client.deleted_at IS NULL
              AND (
                ${query.includeArchivedClients ?? false}
                OR client.status <> 'ARCHIVED'::public.client_status
              )
            ORDER BY client.display_name ASC, client.client_number ASC
            LIMIT 500
          `,
          transaction.$queryRaw<
            Array<{
              id: string;
              label: string;
              status: 'QUALIFIED' | 'CONSULTATION_BOOKED';
              serviceType: string | null;
            }>
          >`
            SELECT
              enquiry.id,
              concat_ws(
                ' · ',
                NULLIF(btrim(concat_ws(' ', enquiry.first_name, enquiry.last_name)), ''),
                NULLIF(btrim(enquiry.service_type), ''),
                enquiry.status::text
              ) AS label,
              enquiry.status::text AS status,
              enquiry.service_type AS "serviceType"
            FROM public.enquiries AS enquiry
            WHERE enquiry.organisation_id = ${context.organisationId}::uuid
              AND enquiry.deleted_at IS NULL
              AND enquiry.status IN (
                'QUALIFIED'::public."EnquiryStatus",
                'CONSULTATION_BOOKED'::public."EnquiryStatus"
              )
            ORDER BY enquiry.created_at ASC, enquiry.id ASC
            LIMIT 200
          `,
        ]);

        return {
          departments,
          teams,
          members,
          clients,
          convertibleEnquiries,
        };
      }),
    );
  }

  async listClients(
    query: ClientQueryDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<ClientListView> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;
    const search = query.search?.trim() || null;
    const pattern = search ? `%${search}%` : null;

    return this.runSafely('client.list', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const rows = await transaction.$queryRaw<ClientRow[]>`
          SELECT
            client.id,
            client.organisation_id AS "organisationId",
            client.client_number AS "clientNumber",
            client.source_enquiry_id AS "sourceEnquiryId",
            client.kind,
            client.status,
            client.display_name AS "displayName",
            client.first_name AS "firstName",
            client.last_name AS "lastName",
            client.organisation_name AS "organisationName",
            client.email,
            client.phone,
            client.date_of_birth AS "dateOfBirth",
            client.nationality,
            client.country_of_residence_code AS "countryOfResidenceCode",
            client.address_line_1 AS "addressLine1",
            client.address_line_2 AS "addressLine2",
            client.city,
            client.region,
            client.postal_code AS "postalCode",
            client.address_country_code AS "addressCountryCode",
            client.preferred_language AS "preferredLanguage",
            client.preferred_communication AS "preferredCommunication",
            client.processing_lawful_basis AS "processingLawfulBasis",
            client.privacy_notice_version AS "privacyNoticeVersion",
            client.privacy_notice_acknowledged_at AS "privacyNoticeAcknowledgedAt",
            client.marketing_consent AS "marketingConsent",
            client.marketing_consent_at AS "marketingConsentAt",
            client.marketing_consent_source AS "marketingConsentSource",
            client.risk_rating AS "riskRating",
            client.identity_verification_status AS "identityVerificationStatus",
            client.identity_verified_at AS "identityVerifiedAt",
            client.identity_verification_expires_at AS "identityVerificationExpiresAt",
            client.assigned_to_user_id AS "assignedToUserId",
            COALESCE(
              NULLIF(btrim(assignee.display_name), ''),
              NULLIF(btrim(concat_ws(' ', assignee.first_name, assignee.last_name)), ''),
              assignee.email
            ) AS "assignedToName",
            client.last_contacted_at AS "lastContactedAt",
            client.retention_review_at AS "retentionReviewAt",
            client.archived_at AS "archivedAt",
            client.archive_reason AS "archiveReason",
            client.version,
            client.created_at AS "createdAt",
            client.updated_at AS "updatedAt",
            count(*) OVER() AS "totalCount"
          FROM public.clients AS client
          LEFT JOIN public.user_profiles AS assignee
            ON assignee.id = client.assigned_to_user_id
          WHERE client.organisation_id = ${context.organisationId}::uuid
            AND client.deleted_at IS NULL
            AND (${query.status ?? null}::text IS NULL OR client.status::text = ${query.status ?? null})
            AND (${query.assignedToUserId ?? null}::uuid IS NULL OR client.assigned_to_user_id = ${query.assignedToUserId ?? null}::uuid)
            AND (
              ${search}::text IS NULL
              OR client.client_number ILIKE ${pattern}
              OR client.display_name ILIKE ${pattern}
              OR client.email ILIKE ${pattern}
              OR client.phone ILIKE ${pattern}
            )
          ORDER BY client.created_at DESC, client.id DESC
          LIMIT ${limit}
          OFFSET ${offset}
        `;
        const total = totalNumber(rows[0]?.totalCount);

        return {
          items: rows.map(clientView),
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        };
      }),
    );
  }

  async getClient(
    clientId: string,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<ClientView> {
    return this.runSafely('client.read', () =>
      this.rls.run(this.rlsContext(context), (transaction) =>
        this.findClient(transaction, context.organisationId, clientId),
      ),
    );
  }

  async createClient(
    dto: CreateClientDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<ClientView> {
    this.validateClientIdentity(dto.kind, dto);
    this.validateClientPrivacy(dto);

    return this.runSafely('client.create', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const clientNumber = await this.allocateNumber(
          transaction,
          context.organisationId,
          'CLIENT',
          'CLI',
        );
        const name = displayName(dto);
        const [created] = await transaction.$queryRaw<Array<{ id: string }>>`
          INSERT INTO public.clients (
            id, organisation_id, client_number, kind, status,
            display_name, first_name, last_name, organisation_name,
            email, phone, date_of_birth, nationality,
            country_of_residence_code, address_line_1, address_line_2,
            city, region, postal_code, address_country_code,
            preferred_language, preferred_communication,
            processing_lawful_basis, privacy_notice_version,
            privacy_notice_acknowledged_at, marketing_consent,
            marketing_consent_at, marketing_consent_source, risk_rating,
            identity_verification_status, identity_verified_at,
            identity_verification_expires_at, assigned_to_user_id,
            retention_review_at, created_by_user_id, updated_by_user_id
          )
          VALUES (
            pg_catalog.gen_random_uuid(), ${context.organisationId}::uuid,
            ${clientNumber}, ${dto.kind}::public.client_kind,
            'ONBOARDING'::public.client_status, ${name},
            ${dto.kind === 'INDIVIDUAL' ? dto.firstName ?? null : null},
            ${dto.kind === 'INDIVIDUAL' ? dto.lastName ?? null : null},
            ${dto.kind === 'ORGANISATION' ? dto.organisationName ?? null : null},
            ${dto.email ?? null}, ${dto.phone ?? null}, ${dto.dateOfBirth ?? null}::date,
            ${dto.nationality ?? null}, ${dto.countryOfResidenceCode ?? null},
            ${dto.addressLine1 ?? null}, ${dto.addressLine2 ?? null},
            ${dto.city ?? null}, ${dto.region ?? null}, ${dto.postalCode ?? null},
            ${dto.addressCountryCode ?? null}, ${dto.preferredLanguage ?? 'en-GB'},
            ${dto.preferredCommunication ?? 'EMAIL'}::public.communication_channel,
            ${dto.processingLawfulBasis}::public.processing_lawful_basis,
            ${dto.privacyNoticeVersion ?? null},
            ${dto.privacyNoticeAcknowledgedAt ?? null}::timestamptz,
            ${dto.marketingConsent ?? false}, ${dto.marketingConsentAt ?? null}::timestamptz,
            ${dto.marketingConsentSource ?? null},
            ${dto.riskRating ?? 'NOT_ASSESSED'}::public.client_risk_rating,
            ${dto.identityVerificationStatus ?? 'NOT_STARTED'}::public.identity_verification_status,
            ${dto.identityVerifiedAt ?? null}::timestamptz,
            ${dto.identityVerificationExpiresAt ?? null}::timestamptz,
            ${dto.assignedToUserId ?? null}::uuid,
            ${dto.retentionReviewAt ?? null}::timestamptz,
            ${context.userId}::uuid, ${context.userId}::uuid
          )
          RETURNING id
        `;

        if (!created) {
          throw new InternalServerErrorException('The client could not be created.');
        }

        await this.writeAudit(
          transaction,
          context,
          'client.created',
          'client',
          created.id,
          null,
          {
            kind: dto.kind,
            status: 'ONBOARDING',
            assignedToUserId: dto.assignedToUserId ?? null,
          },
        );

        return this.findClient(transaction, context.organisationId, created.id);
      }),
    );
  }

  async updateClient(
    clientId: string,
    dto: UpdateClientDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<ClientView> {
    return this.runSafely('client.update', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const current = await this.findClientRow(
          transaction,
          context.organisationId,
          clientId,
        );
        this.assertVersion(current.version, dto.expectedVersion);

        if (current.status === 'ARCHIVED') {
          throw new ConflictException('Archived clients are immutable.');
        }

        this.validateClientIdentity(current.kind, dto);
        this.validateClientPrivacy(dto);
        const name = displayName({ kind: current.kind, ...dto });
        const rows = await transaction.$queryRaw<Array<{ id: string }>>`
          UPDATE public.clients
          SET
            status = ${dto.status}::public.client_status,
            display_name = ${name},
            first_name = ${current.kind === 'INDIVIDUAL' ? dto.firstName : null},
            last_name = ${current.kind === 'INDIVIDUAL' ? dto.lastName : null},
            organisation_name = ${current.kind === 'ORGANISATION' ? dto.organisationName : null},
            email = ${dto.email},
            phone = ${dto.phone},
            date_of_birth = ${dto.dateOfBirth}::date,
            nationality = ${dto.nationality},
            country_of_residence_code = ${dto.countryOfResidenceCode},
            address_line_1 = ${dto.addressLine1},
            address_line_2 = ${dto.addressLine2},
            city = ${dto.city},
            region = ${dto.region},
            postal_code = ${dto.postalCode},
            address_country_code = ${dto.addressCountryCode},
            preferred_language = ${dto.preferredLanguage},
            preferred_communication = ${dto.preferredCommunication}::public.communication_channel,
            processing_lawful_basis = ${dto.processingLawfulBasis}::public.processing_lawful_basis,
            privacy_notice_version = ${dto.privacyNoticeVersion},
            privacy_notice_acknowledged_at = ${dto.privacyNoticeAcknowledgedAt}::timestamptz,
            marketing_consent = ${dto.marketingConsent},
            marketing_consent_at = ${dto.marketingConsentAt}::timestamptz,
            marketing_consent_source = ${dto.marketingConsentSource},
            risk_rating = ${dto.riskRating}::public.client_risk_rating,
            identity_verification_status = ${dto.identityVerificationStatus}::public.identity_verification_status,
            identity_verified_at = ${dto.identityVerifiedAt}::timestamptz,
            identity_verification_expires_at = ${dto.identityVerificationExpiresAt}::timestamptz,
            assigned_to_user_id = ${dto.assignedToUserId}::uuid,
            retention_review_at = ${dto.retentionReviewAt}::timestamptz,
            updated_by_user_id = ${context.userId}::uuid,
            version = version + 1,
            updated_at = pg_catalog.now()
          WHERE id = ${clientId}::uuid
            AND organisation_id = ${context.organisationId}::uuid
            AND version = ${dto.expectedVersion}
            AND deleted_at IS NULL
          RETURNING id
        `;
        this.assertSingleUpdate(rows.length);

        await this.writeAudit(
          transaction,
          context,
          'client.updated',
          'client',
          clientId,
          {
            status: current.status,
            assignedToUserId: current.assignedToUserId,
            riskRating: current.riskRating,
            identityVerificationStatus: current.identityVerificationStatus,
          },
          {
            status: dto.status,
            assignedToUserId: dto.assignedToUserId,
            riskRating: dto.riskRating,
            identityVerificationStatus: dto.identityVerificationStatus,
          },
        );

        return this.findClient(transaction, context.organisationId, clientId);
      }),
    );
  }

  async archiveClient(
    clientId: string,
    dto: ArchiveClientDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<ClientView> {
    return this.runSafely('client.archive', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const current = await this.findClientRow(
          transaction,
          context.organisationId,
          clientId,
        );
        this.assertVersion(current.version, dto.expectedVersion);

        if (current.status === 'ARCHIVED') {
          throw new ConflictException('The client is already archived.');
        }

        const [dependency] = await transaction.$queryRaw<
          Array<{ openCount: bigint | number }>
        >`
          SELECT count(*) AS "openCount"
          FROM public.matter_parties AS party
          JOIN public.matters AS matter
            ON matter.id = party.matter_id
           AND matter.organisation_id = party.organisation_id
          WHERE party.organisation_id = ${context.organisationId}::uuid
            AND party.client_id = ${clientId}::uuid
            AND party.deleted_at IS NULL
            AND matter.deleted_at IS NULL
            AND matter.status NOT IN (
              'CLOSED'::public.matter_status,
              'CANCELLED'::public.matter_status,
              'ARCHIVED'::public.matter_status
            )
        `;

        if (totalNumber(dependency?.openCount) > 0) {
          throw new ConflictException(
            'The client has open matters and cannot be archived.',
          );
        }

        const rows = await transaction.$queryRaw<Array<{ id: string }>>`
          UPDATE public.clients
          SET
            status = 'ARCHIVED'::public.client_status,
            archived_at = pg_catalog.now(),
            archive_reason = ${dto.reason},
            updated_by_user_id = ${context.userId}::uuid,
            version = version + 1,
            updated_at = pg_catalog.now()
          WHERE id = ${clientId}::uuid
            AND organisation_id = ${context.organisationId}::uuid
            AND version = ${dto.expectedVersion}
            AND deleted_at IS NULL
          RETURNING id
        `;
        this.assertSingleUpdate(rows.length);

        await this.writeAudit(
          transaction,
          context,
          'client.archived',
          'client',
          clientId,
          { status: current.status },
          { status: 'ARCHIVED' },
        );

        return this.findClient(transaction, context.organisationId, clientId);
      }),
    );
  }

  async listMatters(
    query: MatterQueryDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<MatterListView> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;
    const search = query.search?.trim() || null;
    const pattern = search ? `%${search}%` : null;

    return this.runSafely('matter.list', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const rows = await transaction.$queryRaw<MatterRow[]>`
          SELECT
            matter.id,
            matter.organisation_id AS "organisationId",
            matter.matter_number AS "matterNumber",
            matter.source_enquiry_id AS "sourceEnquiryId",
            matter.department_id AS "departmentId",
            matter.team_id AS "teamId",
            matter.assigned_to_user_id AS "assignedToUserId",
            COALESCE(
              NULLIF(btrim(assignee.display_name), ''),
              NULLIF(btrim(concat_ws(' ', assignee.first_name, assignee.last_name)), ''),
              assignee.email
            ) AS "assignedToName",
            matter.supervisor_user_id AS "supervisorUserId",
            COALESCE(
              NULLIF(btrim(supervisor.display_name), ''),
              NULLIF(btrim(concat_ws(' ', supervisor.first_name, supervisor.last_name)), ''),
              supervisor.email
            ) AS "supervisorName",
            matter.title,
            matter.description,
            matter.service_type AS "serviceType",
            matter.jurisdiction_country_code AS "jurisdictionCountryCode",
            matter.external_reference AS "externalReference",
            matter.status,
            matter.priority,
            matter.next_action_summary AS "nextActionSummary",
            matter.next_action_at AS "nextActionAt",
            matter.critical_deadline_at AS "criticalDeadlineAt",
            matter.target_completion_at AS "targetCompletionAt",
            matter.opened_at AS "openedAt",
            matter.closed_at AS "closedAt",
            matter.closure_reason AS "closureReason",
            matter.outcome,
            matter.archived_at AS "archivedAt",
            matter.archive_reason AS "archiveReason",
            matter.version,
            matter.created_at AS "createdAt",
            matter.updated_at AS "updatedAt",
            primary_client.id AS "primaryClientId",
            primary_client.display_name AS "primaryClientName",
            count(*) OVER() AS "totalCount"
          FROM public.matters AS matter
          JOIN public.matter_parties AS primary_party
            ON primary_party.matter_id = matter.id
           AND primary_party.organisation_id = matter.organisation_id
           AND primary_party.is_primary = true
           AND primary_party.deleted_at IS NULL
          JOIN public.clients AS primary_client
            ON primary_client.id = primary_party.client_id
           AND primary_client.organisation_id = primary_party.organisation_id
           AND primary_client.deleted_at IS NULL
          LEFT JOIN public.user_profiles AS assignee
            ON assignee.id = matter.assigned_to_user_id
          LEFT JOIN public.user_profiles AS supervisor
            ON supervisor.id = matter.supervisor_user_id
          WHERE matter.organisation_id = ${context.organisationId}::uuid
            AND matter.deleted_at IS NULL
            AND (${query.status ?? null}::text IS NULL OR matter.status::text = ${query.status ?? null})
            AND (${query.priority ?? null}::text IS NULL OR matter.priority::text = ${query.priority ?? null})
            AND (${query.assignedToUserId ?? null}::uuid IS NULL OR matter.assigned_to_user_id = ${query.assignedToUserId ?? null}::uuid)
            AND (${query.clientId ?? null}::uuid IS NULL OR primary_party.client_id = ${query.clientId ?? null}::uuid)
            AND (
              ${search}::text IS NULL
              OR matter.matter_number ILIKE ${pattern}
              OR matter.title ILIKE ${pattern}
              OR matter.service_type ILIKE ${pattern}
              OR primary_client.display_name ILIKE ${pattern}
            )
          ORDER BY
            CASE matter.priority
              WHEN 'URGENT'::public.matter_priority THEN 1
              WHEN 'HIGH'::public.matter_priority THEN 2
              WHEN 'NORMAL'::public.matter_priority THEN 3
              ELSE 4
            END,
            matter.critical_deadline_at ASC NULLS LAST,
            matter.created_at DESC,
            matter.id DESC
          LIMIT ${limit}
          OFFSET ${offset}
        `;
        const total = totalNumber(rows[0]?.totalCount);

        return {
          items: rows.map(matterSummary),
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        };
      }),
    );
  }

  async getMatter(
    matterId: string,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<MatterView> {
    return this.runSafely('matter.read', () =>
      this.rls.run(this.rlsContext(context), (transaction) =>
        this.findMatter(transaction, context.organisationId, matterId),
      ),
    );
  }

  async createMatter(
    dto: CreateMatterDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<MatterView> {
    this.validateNextAction(dto.nextActionSummary, dto.nextActionAt);

    return this.runSafely('matter.create', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        await this.findClientRow(
          transaction,
          context.organisationId,
          dto.primaryClientId,
          false,
        );
        const matterNumber = await this.allocateNumber(
          transaction,
          context.organisationId,
          'MATTER',
          'MAT',
        );
        const [created] = await transaction.$queryRaw<Array<{ id: string }>>`
          INSERT INTO public.matters (
            id, organisation_id, matter_number, department_id, team_id,
            assigned_to_user_id, supervisor_user_id, title, description,
            service_type, jurisdiction_country_code, external_reference,
            status, priority, next_action_summary, next_action_at,
            critical_deadline_at, target_completion_at,
            created_by_user_id, updated_by_user_id
          )
          VALUES (
            pg_catalog.gen_random_uuid(), ${context.organisationId}::uuid,
            ${matterNumber}, ${dto.departmentId ?? null}::uuid,
            ${dto.teamId ?? null}::uuid, ${dto.assignedToUserId ?? null}::uuid,
            ${dto.supervisorUserId ?? null}::uuid, ${dto.title},
            ${dto.description ?? null}, ${dto.serviceType},
            ${dto.jurisdictionCountryCode ?? null}, ${dto.externalReference ?? null},
            'INTAKE'::public.matter_status,
            ${dto.priority ?? 'NORMAL'}::public.matter_priority,
            ${dto.nextActionSummary ?? null}, ${dto.nextActionAt ?? null}::timestamptz,
            ${dto.criticalDeadlineAt ?? null}::timestamptz,
            ${dto.targetCompletionAt ?? null}::timestamptz,
            ${context.userId}::uuid, ${context.userId}::uuid
          )
          RETURNING id
        `;

        if (!created) {
          throw new InternalServerErrorException('The matter could not be created.');
        }

        await transaction.$executeRaw`
          INSERT INTO public.matter_parties (
            id, organisation_id, matter_id, client_id, role, is_primary
          )
          VALUES (
            pg_catalog.gen_random_uuid(), ${context.organisationId}::uuid,
            ${created.id}::uuid, ${dto.primaryClientId}::uuid,
            'PRIMARY_CLIENT'::public.matter_party_role, true
          )
        `;
        await this.createInitialCompliance(transaction, context, created.id);
        await this.writeStatusHistory(
          transaction,
          context,
          created.id,
          null,
          'INTAKE',
          'Matter opened.',
        );
        await this.writeAudit(
          transaction,
          context,
          'matter.created',
          'matter',
          created.id,
          null,
          {
            status: 'INTAKE',
            priority: dto.priority ?? 'NORMAL',
            primaryClientId: dto.primaryClientId,
            assignedToUserId: dto.assignedToUserId ?? null,
            departmentId: dto.departmentId ?? null,
            teamId: dto.teamId ?? null,
          },
        );

        return this.findMatter(transaction, context.organisationId, created.id);
      }),
    );
  }

  async updateMatter(
    matterId: string,
    dto: UpdateMatterDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<MatterView> {
    this.validateNextAction(dto.nextActionSummary, dto.nextActionAt);

    return this.runSafely('matter.update', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const current = await this.findMatterRow(
          transaction,
          context.organisationId,
          matterId,
        );
        this.assertVersion(current.version, dto.expectedVersion);

        if (current.status === 'ARCHIVED') {
          throw new ConflictException('Archived matters cannot be changed.');
        }

        const rows = await transaction.$queryRaw<Array<{ id: string }>>`
          UPDATE public.matters
          SET
            department_id = ${dto.departmentId}::uuid,
            team_id = ${dto.teamId}::uuid,
            assigned_to_user_id = ${dto.assignedToUserId}::uuid,
            supervisor_user_id = ${dto.supervisorUserId}::uuid,
            title = ${dto.title},
            description = ${dto.description},
            service_type = ${dto.serviceType},
            jurisdiction_country_code = ${dto.jurisdictionCountryCode},
            external_reference = ${dto.externalReference},
            priority = ${dto.priority}::public.matter_priority,
            next_action_summary = ${dto.nextActionSummary},
            next_action_at = ${dto.nextActionAt}::timestamptz,
            critical_deadline_at = ${dto.criticalDeadlineAt}::timestamptz,
            target_completion_at = ${dto.targetCompletionAt}::timestamptz,
            updated_by_user_id = ${context.userId}::uuid,
            version = version + 1,
            updated_at = pg_catalog.now()
          WHERE id = ${matterId}::uuid
            AND organisation_id = ${context.organisationId}::uuid
            AND version = ${dto.expectedVersion}
            AND deleted_at IS NULL
          RETURNING id
        `;
        this.assertSingleUpdate(rows.length);

        await this.writeAudit(
          transaction,
          context,
          'matter.updated',
          'matter',
          matterId,
          {
            priority: current.priority,
            assignedToUserId: current.assignedToUserId,
            supervisorUserId: current.supervisorUserId,
            departmentId: current.departmentId,
            teamId: current.teamId,
          },
          {
            priority: dto.priority,
            assignedToUserId: dto.assignedToUserId,
            supervisorUserId: dto.supervisorUserId,
            departmentId: dto.departmentId,
            teamId: dto.teamId,
          },
        );

        return this.findMatter(transaction, context.organisationId, matterId);
      }),
    );
  }

  async changeMatterStatus(
    matterId: string,
    dto: ChangeMatterStatusDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<MatterView> {
    return this.runSafely('matter.status.change', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const current = await this.findMatterRow(
          transaction,
          context.organisationId,
          matterId,
        );
        this.assertVersion(current.version, dto.expectedVersion);
        this.assertMatterTransition(current.status, dto.toStatus);
        const compliance = await this.findCompliance(
          transaction,
          context.organisationId,
          matterId,
        );
        this.assertComplianceGate(dto.toStatus, compliance);

        const closing = dto.toStatus === 'CLOSED' || dto.toStatus === 'CANCELLED';
        const archiving = dto.toStatus === 'ARCHIVED';
        const rows = await transaction.$queryRaw<Array<{ id: string }>>`
          UPDATE public.matters
          SET
            status = ${dto.toStatus}::public.matter_status,
            closed_at = CASE
              WHEN ${closing} THEN pg_catalog.now()
              ELSE closed_at
            END,
            closure_reason = CASE
              WHEN ${closing} THEN ${dto.reason}
              ELSE closure_reason
            END,
            outcome = CASE
              WHEN ${closing} THEN ${dto.outcome ?? null}
              ELSE outcome
            END,
            archived_at = CASE
              WHEN ${archiving} THEN pg_catalog.now()
              ELSE archived_at
            END,
            archive_reason = CASE
              WHEN ${archiving} THEN ${dto.reason}
              ELSE archive_reason
            END,
            updated_by_user_id = ${context.userId}::uuid,
            version = version + 1,
            updated_at = pg_catalog.now()
          WHERE id = ${matterId}::uuid
            AND organisation_id = ${context.organisationId}::uuid
            AND version = ${dto.expectedVersion}
            AND deleted_at IS NULL
          RETURNING id
        `;
        this.assertSingleUpdate(rows.length);

        await this.writeStatusHistory(
          transaction,
          context,
          matterId,
          current.status,
          dto.toStatus,
          dto.reason,
        );
        await this.writeAudit(
          transaction,
          context,
          'matter.status_changed',
          'matter',
          matterId,
          { status: current.status },
          { status: dto.toStatus },
        );

        return this.findMatter(transaction, context.organisationId, matterId);
      }),
    );
  }

  async updateMatterCompliance(
    matterId: string,
    dto: UpdateMatterComplianceDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<MatterView> {
    return this.runSafely('matter.compliance.update', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const matter = await this.findMatterRow(
          transaction,
          context.organisationId,
          matterId,
        );
        const current = await this.findCompliance(
          transaction,
          context.organisationId,
          matterId,
        );
        this.assertVersion(current.version, dto.expectedVersion);

        if (matter.status === 'ARCHIVED') {
          throw new ConflictException('Archived matter compliance is immutable.');
        }

        if (dto.riskRating === 'HIGH' && !dto.riskReason?.trim()) {
          throw new BadRequestException(
            'A reason is required when the matter risk rating is high.',
          );
        }

        if (
          ['ACTIVE', 'SUBMITTED'].includes(matter.status) &&
          !this.complianceAllowsActiveWork(dto)
        ) {
          throw new ConflictException(
            'Active or submitted matters must retain cleared conflict, accepted client-care and valid AML controls.',
          );
        }

        const rows = await transaction.$queryRaw<Array<{ id: string }>>`
          UPDATE public.matter_compliance
          SET
            conflict_status = ${dto.conflictStatus}::public.conflict_check_status,
            conflict_reference = ${dto.conflictReference},
            conflict_checked_at = CASE
              WHEN ${dto.conflictStatus} IN (
                'CLEARED'::public.conflict_check_status,
                'FLAGGED'::public.conflict_check_status,
                'WAIVED'::public.conflict_check_status
              ) THEN pg_catalog.now()
              ELSE NULL
            END,
            conflict_checked_by_user_id = CASE
              WHEN ${dto.conflictStatus} IN (
                'CLEARED'::public.conflict_check_status,
                'FLAGGED'::public.conflict_check_status,
                'WAIVED'::public.conflict_check_status
              ) THEN ${context.userId}::uuid
              ELSE NULL
            END,
            aml_status = ${dto.amlStatus}::public.aml_check_status,
            aml_reference = ${dto.amlReference},
            aml_checked_at = CASE
              WHEN ${dto.amlStatus} IN (
                'NOT_REQUIRED'::public.aml_check_status,
                'VERIFIED'::public.aml_check_status,
                'FAILED'::public.aml_check_status,
                'EXPIRED'::public.aml_check_status
              ) THEN pg_catalog.now()
              ELSE NULL
            END,
            aml_checked_by_user_id = CASE
              WHEN ${dto.amlStatus} IN (
                'NOT_REQUIRED'::public.aml_check_status,
                'VERIFIED'::public.aml_check_status,
                'FAILED'::public.aml_check_status,
                'EXPIRED'::public.aml_check_status
              ) THEN ${context.userId}::uuid
              ELSE NULL
            END,
            client_care_status = ${dto.clientCareStatus}::public.client_care_status,
            client_care_sent_at = CASE
              WHEN ${dto.clientCareStatus} = 'NOT_SENT'::public.client_care_status
                THEN NULL
              ELSE COALESCE(client_care_sent_at, pg_catalog.now())
            END,
            client_care_responded_at = CASE
              WHEN ${dto.clientCareStatus} IN (
                'ACCEPTED'::public.client_care_status,
                'DECLINED'::public.client_care_status
              ) THEN pg_catalog.now()
              ELSE NULL
            END,
            risk_rating = ${dto.riskRating}::public.client_risk_rating,
            risk_reason = ${dto.riskReason},
            risk_reviewed_at = CASE
              WHEN ${dto.riskRating} = 'NOT_ASSESSED'::public.client_risk_rating
                THEN NULL
              ELSE pg_catalog.now()
            END,
            risk_reviewed_by_user_id = CASE
              WHEN ${dto.riskRating} = 'NOT_ASSESSED'::public.client_risk_rating
                THEN NULL
              ELSE ${context.userId}::uuid
            END,
            updated_by_user_id = ${context.userId}::uuid,
            version = version + 1,
            updated_at = pg_catalog.now()
          WHERE matter_id = ${matterId}::uuid
            AND organisation_id = ${context.organisationId}::uuid
            AND version = ${dto.expectedVersion}
          RETURNING id
        `;
        this.assertSingleUpdate(rows.length);

        await this.writeAudit(
          transaction,
          context,
          'matter.compliance_updated',
          'matter',
          matterId,
          {
            conflictStatus: current.conflictStatus,
            amlStatus: current.amlStatus,
            clientCareStatus: current.clientCareStatus,
            riskRating: current.riskRating,
          },
          {
            conflictStatus: dto.conflictStatus,
            amlStatus: dto.amlStatus,
            clientCareStatus: dto.clientCareStatus,
            riskRating: dto.riskRating,
          },
        );

        return this.findMatter(transaction, context.organisationId, matterId);
      }),
    );
  }

  async addMatterParty(
    matterId: string,
    dto: AddMatterPartyDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<MatterView> {
    if (dto.role === 'OTHER' && !dto.roleDescription?.trim()) {
      throw new BadRequestException(
        'A relationship description is required for an additional party.',
      );
    }

    return this.runSafely('matter.party.add', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const matter = await this.findMatterRow(
          transaction,
          context.organisationId,
          matterId,
        );

        if (matter.status === 'ARCHIVED') {
          throw new ConflictException('Archived matter parties are immutable.');
        }

        await this.findClientRow(
          transaction,
          context.organisationId,
          dto.clientId,
          false,
        );
        const [party] = await transaction.$queryRaw<Array<{ id: string }>>`
          INSERT INTO public.matter_parties (
            id, organisation_id, matter_id, client_id, role,
            is_primary, role_description
          )
          VALUES (
            pg_catalog.gen_random_uuid(), ${context.organisationId}::uuid,
            ${matterId}::uuid, ${dto.clientId}::uuid,
            ${dto.role}::public.matter_party_role, false,
            ${dto.roleDescription ?? null}
          )
          RETURNING id
        `;

        if (!party) {
          throw new InternalServerErrorException('The matter party could not be added.');
        }

        await this.writeAudit(
          transaction,
          context,
          'matter.party_added',
          'matter',
          matterId,
          null,
          { partyId: party.id, clientId: dto.clientId, role: dto.role },
        );

        return this.findMatter(transaction, context.organisationId, matterId);
      }),
    );
  }

  async removeMatterParty(
    matterId: string,
    partyId: string,
    dto: RemoveMatterPartyDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<MatterView> {
    return this.runSafely('matter.party.remove', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const matter = await this.findMatterRow(
          transaction,
          context.organisationId,
          matterId,
        );

        if (matter.status === 'ARCHIVED') {
          throw new ConflictException('Archived matter parties are immutable.');
        }

        const [party] = await transaction.$queryRaw<
          Array<{ id: string; clientId: string; role: string; isPrimary: boolean }>
        >`
          SELECT
            party.id,
            party.client_id AS "clientId",
            party.role::text AS role,
            party.is_primary AS "isPrimary"
          FROM public.matter_parties AS party
          WHERE party.id = ${partyId}::uuid
            AND party.matter_id = ${matterId}::uuid
            AND party.organisation_id = ${context.organisationId}::uuid
            AND party.deleted_at IS NULL
          FOR UPDATE
        `;

        if (!party) {
          throw new NotFoundException('Matter party not found.');
        }

        if (party.isPrimary) {
          throw new ConflictException('The primary client cannot be removed.');
        }

        const changed = await transaction.$executeRaw`
          UPDATE public.matter_parties
          SET deleted_at = pg_catalog.now(), updated_at = pg_catalog.now()
          WHERE id = ${partyId}::uuid
            AND matter_id = ${matterId}::uuid
            AND organisation_id = ${context.organisationId}::uuid
            AND deleted_at IS NULL
        `;
        this.assertSingleUpdate(changed);

        await this.writeAudit(
          transaction,
          context,
          'matter.party_removed',
          'matter',
          matterId,
          { partyId, clientId: party.clientId, role: party.role },
          null,
          { reasonRecorded: Boolean(dto.reason) },
        );

        return this.findMatter(transaction, context.organisationId, matterId);
      }),
    );
  }

  async convertEnquiry(
    enquiryId: string,
    dto: ConvertEnquiryDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<EnquiryConversionResult> {
    this.validateNextAction(dto.nextActionSummary, dto.nextActionAt);
    this.validatePrivacyPair(
      dto.privacyNoticeVersion ?? null,
      dto.privacyNoticeAcknowledgedAt ?? null,
    );

    return this.runSafely('enquiry.convert', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const priorByKey = await this.findConversionByKey(
          transaction,
          context.organisationId,
          dto.idempotencyKey,
        );

        if (priorByKey) {
          if (priorByKey.enquiryId !== enquiryId) {
            throw new ConflictException(
              'The idempotency key has already been used for another conversion.',
            );
          }

          return this.conversionResult(priorByKey, true);
        }

        const [enquiry] = await transaction.$queryRaw<EnquiryForConversionRow[]>`
          SELECT
            enquiry.id,
            enquiry.first_name AS "firstName",
            enquiry.last_name AS "lastName",
            enquiry.email,
            enquiry.phone,
            enquiry.country,
            enquiry.service_type AS "serviceType",
            enquiry.status::text AS status,
            enquiry.assigned_to_user_id AS "assignedToUserId"
          FROM public.enquiries AS enquiry
          WHERE enquiry.id = ${enquiryId}::uuid
            AND enquiry.organisation_id = ${context.organisationId}::uuid
            AND enquiry.deleted_at IS NULL
          FOR UPDATE
        `;

        if (!enquiry) {
          throw new NotFoundException('Enquiry not found.');
        }

        const existingConversion = await this.findConversionByEnquiry(
          transaction,
          context.organisationId,
          enquiryId,
        );

        if (existingConversion) {
          throw new ConflictException(
            'The enquiry has already been converted. Use the original conversion result.',
          );
        }

        assertEnquiryCanConvert(enquiry.status as EnquiryStatus);

        let clientId: string;
        let clientNumber: string;

        if (dto.existingClientId) {
          const existingClient = await this.findClientRow(
            transaction,
            context.organisationId,
            dto.existingClientId,
            false,
          );

          if (existingClient.status === 'ARCHIVED') {
            throw new ConflictException(
              'An archived client cannot receive a new matter.',
            );
          }

          clientId = existingClient.id;
          clientNumber = existingClient.clientNumber;
        } else {
          if (!enquiry.email && !enquiry.phone) {
            throw new BadRequestException(
              'The enquiry must contain an email address or telephone number before conversion.',
            );
          }

          const [duplicate] = await transaction.$queryRaw<Array<{ id: string }>>`
            SELECT client.id
            FROM public.clients AS client
            WHERE client.organisation_id = ${context.organisationId}::uuid
              AND client.deleted_at IS NULL
              AND (
                (${enquiry.email}::text IS NOT NULL AND client.email = lower(${enquiry.email}))
                OR (${enquiry.phone}::text IS NOT NULL AND client.phone = ${enquiry.phone})
              )
            LIMIT 1
          `;

          if (duplicate) {
            throw new ConflictException(
              'A client with the same verified contact details already exists. Select that client instead.',
            );
          }

          const kind = dto.clientKind ?? 'INDIVIDUAL';
          const organisationName = dto.clientOrganisationName?.trim() || null;
          this.validateClientIdentity(kind, {
            firstName: enquiry.firstName,
            lastName: enquiry.lastName,
            organisationName,
            email: enquiry.email,
            phone: enquiry.phone,
          });
          clientNumber = await this.allocateNumber(
            transaction,
            context.organisationId,
            'CLIENT',
            'CLI',
          );
          const name = displayName({
            kind,
            firstName: enquiry.firstName,
            lastName: enquiry.lastName,
            organisationName,
          });
          const [createdClient] = await transaction.$queryRaw<Array<{ id: string }>>`
            INSERT INTO public.clients (
              id, organisation_id, client_number, source_enquiry_id,
              kind, status, display_name, first_name, last_name,
              organisation_name, email, phone, country_of_residence_code,
              preferred_language, preferred_communication,
              processing_lawful_basis, privacy_notice_version,
              privacy_notice_acknowledged_at, assigned_to_user_id,
              created_by_user_id, updated_by_user_id
            )
            VALUES (
              pg_catalog.gen_random_uuid(), ${context.organisationId}::uuid,
              ${clientNumber}, ${enquiryId}::uuid,
              ${kind}::public.client_kind, 'ONBOARDING'::public.client_status,
              ${name},
              ${kind === 'INDIVIDUAL' ? enquiry.firstName : null},
              ${kind === 'INDIVIDUAL' ? enquiry.lastName : null},
              ${kind === 'ORGANISATION' ? organisationName : null},
              ${enquiry.email?.trim().toLowerCase() ?? null}, ${enquiry.phone},
              ${this.countryCode(enquiry.country)}, 'en-GB',
              ${enquiry.email ? 'EMAIL' : 'PHONE'}::public.communication_channel,
              ${dto.processingLawfulBasis}::public.processing_lawful_basis,
              ${dto.privacyNoticeVersion ?? null},
              ${dto.privacyNoticeAcknowledgedAt ?? null}::timestamptz,
              ${dto.clientAssignedToUserId ?? enquiry.assignedToUserId ?? null}::uuid,
              ${context.userId}::uuid, ${context.userId}::uuid
            )
            RETURNING id
          `;

          if (!createdClient) {
            throw new InternalServerErrorException('The client could not be created.');
          }

          clientId = createdClient.id;
        }

        const matterNumber = await this.allocateNumber(
          transaction,
          context.organisationId,
          'MATTER',
          'MAT',
        );
        const [createdMatter] = await transaction.$queryRaw<Array<{ id: string }>>`
          INSERT INTO public.matters (
            id, organisation_id, matter_number, source_enquiry_id,
            department_id, team_id, assigned_to_user_id, supervisor_user_id,
            title, description, service_type, jurisdiction_country_code,
            status, priority, next_action_summary, next_action_at,
            critical_deadline_at, target_completion_at,
            created_by_user_id, updated_by_user_id
          )
          VALUES (
            pg_catalog.gen_random_uuid(), ${context.organisationId}::uuid,
            ${matterNumber}, ${enquiryId}::uuid,
            ${dto.departmentId ?? null}::uuid, ${dto.teamId ?? null}::uuid,
            ${dto.assignedToUserId ?? enquiry.assignedToUserId ?? null}::uuid,
            ${dto.supervisorUserId ?? null}::uuid,
            ${dto.matterTitle}, ${dto.matterDescription ?? null},
            ${dto.serviceType || enquiry.serviceType || 'General service'},
            ${dto.jurisdictionCountryCode ?? this.countryCode(enquiry.country)},
            'INTAKE'::public.matter_status,
            ${dto.priority ?? 'NORMAL'}::public.matter_priority,
            ${dto.nextActionSummary ?? null}, ${dto.nextActionAt ?? null}::timestamptz,
            ${dto.criticalDeadlineAt ?? null}::timestamptz,
            ${dto.targetCompletionAt ?? null}::timestamptz,
            ${context.userId}::uuid, ${context.userId}::uuid
          )
          RETURNING id
        `;

        if (!createdMatter) {
          throw new InternalServerErrorException('The matter could not be created.');
        }

        await transaction.$executeRaw`
          INSERT INTO public.matter_parties (
            id, organisation_id, matter_id, client_id, role, is_primary
          )
          VALUES (
            pg_catalog.gen_random_uuid(), ${context.organisationId}::uuid,
            ${createdMatter.id}::uuid, ${clientId}::uuid,
            'PRIMARY_CLIENT'::public.matter_party_role, true
          )
        `;
        await this.createInitialCompliance(
          transaction,
          context,
          createdMatter.id,
        );
        await this.writeStatusHistory(
          transaction,
          context,
          createdMatter.id,
          null,
          'INTAKE',
          'Matter opened through authorised enquiry conversion.',
        );
        const enquiryUpdates = await transaction.$executeRaw`
          UPDATE public.enquiries
          SET
            status = 'CONVERTED'::public."EnquiryStatus",
            converted_at = pg_catalog.now(),
            updated_by_user_id = ${context.userId}::uuid,
            updated_at = pg_catalog.now()
          WHERE id = ${enquiryId}::uuid
            AND organisation_id = ${context.organisationId}::uuid
            AND deleted_at IS NULL
        `;
        this.assertSingleUpdate(enquiryUpdates);
        await transaction.$executeRaw`
          INSERT INTO public.enquiry_conversions (
            id, organisation_id, enquiry_id, client_id, matter_id,
            idempotency_key, converted_by_user_id
          )
          VALUES (
            pg_catalog.gen_random_uuid(), ${context.organisationId}::uuid,
            ${enquiryId}::uuid, ${clientId}::uuid, ${createdMatter.id}::uuid,
            ${dto.idempotencyKey}::uuid, ${context.userId}::uuid
          )
        `;
        await this.writeAudit(
          transaction,
          context,
          'enquiry.converted',
          'enquiry',
          enquiryId,
          { status: enquiry.status },
          {
            status: 'CONVERTED',
            clientId,
            matterId: createdMatter.id,
            usedExistingClient: Boolean(dto.existingClientId),
          },
        );

        return {
          enquiryId,
          clientId,
          matterId: createdMatter.id,
          clientNumber,
          matterNumber,
          repeated: false,
        };
      }),
    );
  }

  private async findClient(
    transaction: Transaction,
    organisationId: string,
    clientId: string,
  ): Promise<ClientView> {
    return clientView(
      await this.findClientRow(transaction, organisationId, clientId),
    );
  }

  private async findClientRow(
    transaction: Transaction,
    organisationId: string,
    clientId: string,
    allowArchived = true,
  ): Promise<ClientRow> {
    const [row] = await transaction.$queryRaw<ClientRow[]>`
      SELECT
        client.id,
        client.organisation_id AS "organisationId",
        client.client_number AS "clientNumber",
        client.source_enquiry_id AS "sourceEnquiryId",
        client.kind,
        client.status,
        client.display_name AS "displayName",
        client.first_name AS "firstName",
        client.last_name AS "lastName",
        client.organisation_name AS "organisationName",
        client.email,
        client.phone,
        client.date_of_birth AS "dateOfBirth",
        client.nationality,
        client.country_of_residence_code AS "countryOfResidenceCode",
        client.address_line_1 AS "addressLine1",
        client.address_line_2 AS "addressLine2",
        client.city,
        client.region,
        client.postal_code AS "postalCode",
        client.address_country_code AS "addressCountryCode",
        client.preferred_language AS "preferredLanguage",
        client.preferred_communication AS "preferredCommunication",
        client.processing_lawful_basis AS "processingLawfulBasis",
        client.privacy_notice_version AS "privacyNoticeVersion",
        client.privacy_notice_acknowledged_at AS "privacyNoticeAcknowledgedAt",
        client.marketing_consent AS "marketingConsent",
        client.marketing_consent_at AS "marketingConsentAt",
        client.marketing_consent_source AS "marketingConsentSource",
        client.risk_rating AS "riskRating",
        client.identity_verification_status AS "identityVerificationStatus",
        client.identity_verified_at AS "identityVerifiedAt",
        client.identity_verification_expires_at AS "identityVerificationExpiresAt",
        client.assigned_to_user_id AS "assignedToUserId",
        COALESCE(
          NULLIF(btrim(assignee.display_name), ''),
          NULLIF(btrim(concat_ws(' ', assignee.first_name, assignee.last_name)), ''),
          assignee.email
        ) AS "assignedToName",
        client.last_contacted_at AS "lastContactedAt",
        client.retention_review_at AS "retentionReviewAt",
        client.archived_at AS "archivedAt",
        client.archive_reason AS "archiveReason",
        client.version,
        client.created_at AS "createdAt",
        client.updated_at AS "updatedAt"
      FROM public.clients AS client
      LEFT JOIN public.user_profiles AS assignee
        ON assignee.id = client.assigned_to_user_id
      WHERE client.id = ${clientId}::uuid
        AND client.organisation_id = ${organisationId}::uuid
        AND client.deleted_at IS NULL
        AND (${allowArchived} OR client.status <> 'ARCHIVED'::public.client_status)
    `;

    if (!row) {
      throw new NotFoundException('Client not found.');
    }

    return row;
  }

  private async findMatter(
    transaction: Transaction,
    organisationId: string,
    matterId: string,
  ): Promise<MatterView> {
    const matter = await this.findMatterRow(transaction, organisationId, matterId);
    const [compliance, parties, history] = await Promise.all([
      this.findCompliance(transaction, organisationId, matterId),
      transaction.$queryRaw<PartyRow[]>`
        SELECT
          party.id,
          party.client_id AS "clientId",
          client.client_number AS "clientNumber",
          client.display_name AS "clientName",
          party.role,
          party.is_primary AS "isPrimary",
          party.role_description AS "roleDescription",
          party.updated_at AS "updatedAt"
        FROM public.matter_parties AS party
        JOIN public.clients AS client
          ON client.id = party.client_id
         AND client.organisation_id = party.organisation_id
        WHERE party.matter_id = ${matterId}::uuid
          AND party.organisation_id = ${organisationId}::uuid
          AND party.deleted_at IS NULL
          AND client.deleted_at IS NULL
        ORDER BY party.is_primary DESC, client.display_name ASC
      `,
      transaction.$queryRaw<StatusHistoryRow[]>`
        SELECT
          history.id,
          history.from_status AS "fromStatus",
          history.to_status AS "toStatus",
          history.reason,
          history.changed_by_user_id AS "changedByUserId",
          COALESCE(
            NULLIF(btrim(actor.display_name), ''),
            NULLIF(btrim(concat_ws(' ', actor.first_name, actor.last_name)), ''),
            actor.email
          ) AS "changedByName",
          history.occurred_at AS "occurredAt"
        FROM public.matter_status_history AS history
        JOIN public.user_profiles AS actor ON actor.id = history.changed_by_user_id
        WHERE history.matter_id = ${matterId}::uuid
          AND history.organisation_id = ${organisationId}::uuid
        ORDER BY history.occurred_at DESC, history.id DESC
      `,
    ]);

    return {
      ...matterSummary(matter),
      organisationId: matter.organisationId,
      sourceEnquiryId: matter.sourceEnquiryId,
      description: matter.description,
      jurisdictionCountryCode: matter.jurisdictionCountryCode,
      externalReference: matter.externalReference,
      supervisorUserId: matter.supervisorUserId,
      supervisorName: matter.supervisorName,
      nextActionSummary: matter.nextActionSummary,
      targetCompletionAt: nullableIso(matter.targetCompletionAt),
      openedAt: iso(matter.openedAt),
      closedAt: nullableIso(matter.closedAt),
      closureReason: matter.closureReason,
      outcome: matter.outcome,
      archivedAt: nullableIso(matter.archivedAt),
      archiveReason: matter.archiveReason,
      compliance: complianceView(compliance),
      parties: parties.map((party) => ({
        ...party,
        updatedAt: iso(party.updatedAt),
      })),
      statusHistory: history.map((entry) => ({
        ...entry,
        occurredAt: iso(entry.occurredAt),
      })),
    };
  }

  private async findMatterRow(
    transaction: Transaction,
    organisationId: string,
    matterId: string,
  ): Promise<MatterRow> {
    const [row] = await transaction.$queryRaw<MatterRow[]>`
      SELECT
        matter.id,
        matter.organisation_id AS "organisationId",
        matter.matter_number AS "matterNumber",
        matter.source_enquiry_id AS "sourceEnquiryId",
        matter.department_id AS "departmentId",
        matter.team_id AS "teamId",
        matter.assigned_to_user_id AS "assignedToUserId",
        COALESCE(
          NULLIF(btrim(assignee.display_name), ''),
          NULLIF(btrim(concat_ws(' ', assignee.first_name, assignee.last_name)), ''),
          assignee.email
        ) AS "assignedToName",
        matter.supervisor_user_id AS "supervisorUserId",
        COALESCE(
          NULLIF(btrim(supervisor.display_name), ''),
          NULLIF(btrim(concat_ws(' ', supervisor.first_name, supervisor.last_name)), ''),
          supervisor.email
        ) AS "supervisorName",
        matter.title,
        matter.description,
        matter.service_type AS "serviceType",
        matter.jurisdiction_country_code AS "jurisdictionCountryCode",
        matter.external_reference AS "externalReference",
        matter.status,
        matter.priority,
        matter.next_action_summary AS "nextActionSummary",
        matter.next_action_at AS "nextActionAt",
        matter.critical_deadline_at AS "criticalDeadlineAt",
        matter.target_completion_at AS "targetCompletionAt",
        matter.opened_at AS "openedAt",
        matter.closed_at AS "closedAt",
        matter.closure_reason AS "closureReason",
        matter.outcome,
        matter.archived_at AS "archivedAt",
        matter.archive_reason AS "archiveReason",
        matter.version,
        matter.created_at AS "createdAt",
        matter.updated_at AS "updatedAt",
        primary_client.id AS "primaryClientId",
        primary_client.display_name AS "primaryClientName"
      FROM public.matters AS matter
      JOIN public.matter_parties AS primary_party
        ON primary_party.matter_id = matter.id
       AND primary_party.organisation_id = matter.organisation_id
       AND primary_party.is_primary = true
       AND primary_party.deleted_at IS NULL
      JOIN public.clients AS primary_client
        ON primary_client.id = primary_party.client_id
       AND primary_client.organisation_id = primary_party.organisation_id
       AND primary_client.deleted_at IS NULL
      LEFT JOIN public.user_profiles AS assignee
        ON assignee.id = matter.assigned_to_user_id
      LEFT JOIN public.user_profiles AS supervisor
        ON supervisor.id = matter.supervisor_user_id
      WHERE matter.id = ${matterId}::uuid
        AND matter.organisation_id = ${organisationId}::uuid
        AND matter.deleted_at IS NULL
    `;

    if (!row) {
      throw new NotFoundException('Matter not found.');
    }

    return row;
  }

  private async findCompliance(
    transaction: Transaction,
    organisationId: string,
    matterId: string,
  ): Promise<ComplianceRow> {
    const [row] = await transaction.$queryRaw<ComplianceRow[]>`
      SELECT
        compliance.id,
        compliance.conflict_status AS "conflictStatus",
        compliance.conflict_reference AS "conflictReference",
        compliance.conflict_checked_at AS "conflictCheckedAt",
        compliance.conflict_checked_by_user_id AS "conflictCheckedByUserId",
        compliance.aml_status AS "amlStatus",
        compliance.aml_reference AS "amlReference",
        compliance.aml_checked_at AS "amlCheckedAt",
        compliance.aml_checked_by_user_id AS "amlCheckedByUserId",
        compliance.client_care_status AS "clientCareStatus",
        compliance.client_care_sent_at AS "clientCareSentAt",
        compliance.client_care_responded_at AS "clientCareRespondedAt",
        compliance.risk_rating AS "riskRating",
        compliance.risk_reason AS "riskReason",
        compliance.risk_reviewed_at AS "riskReviewedAt",
        compliance.risk_reviewed_by_user_id AS "riskReviewedByUserId",
        compliance.version,
        compliance.updated_at AS "updatedAt"
      FROM public.matter_compliance AS compliance
      WHERE compliance.matter_id = ${matterId}::uuid
        AND compliance.organisation_id = ${organisationId}::uuid
    `;

    if (!row) {
      throw new InternalServerErrorException(
        'The matter compliance record is missing.',
      );
    }

    return row;
  }

  private async createInitialCompliance(
    transaction: Transaction,
    context: Readonly<OrganisationAccessContext>,
    matterId: string,
  ): Promise<void> {
    await transaction.$executeRaw`
      INSERT INTO public.matter_compliance (
        id, organisation_id, matter_id,
        created_by_user_id, updated_by_user_id
      )
      VALUES (
        pg_catalog.gen_random_uuid(), ${context.organisationId}::uuid,
        ${matterId}::uuid, ${context.userId}::uuid, ${context.userId}::uuid
      )
    `;
  }

  private async writeStatusHistory(
    transaction: Transaction,
    context: Readonly<OrganisationAccessContext>,
    matterId: string,
    fromStatus: MatterStatus | null,
    toStatus: MatterStatus,
    reason: string,
  ): Promise<void> {
    await transaction.$executeRaw`
      INSERT INTO public.matter_status_history (
        id, organisation_id, matter_id, from_status, to_status,
        reason, changed_by_user_id
      )
      VALUES (
        pg_catalog.gen_random_uuid(), ${context.organisationId}::uuid,
        ${matterId}::uuid, ${fromStatus}::public.matter_status,
        ${toStatus}::public.matter_status, ${reason}, ${context.userId}::uuid
      )
    `;
  }

  private async allocateNumber(
    transaction: Transaction,
    organisationId: string,
    key: 'CLIENT' | 'MATTER',
    prefix: 'CLI' | 'MAT',
  ): Promise<string> {
    const [row] = await transaction.$queryRaw<Array<{ value: bigint | number }>>`
      INSERT INTO public.organisation_number_sequences (
        id, organisation_id, key, next_value
      )
      VALUES (
        pg_catalog.gen_random_uuid(), ${organisationId}::uuid, ${key}, 2
      )
      ON CONFLICT (organisation_id, key)
      DO UPDATE SET
        next_value = public.organisation_number_sequences.next_value + 1,
        updated_at = pg_catalog.now()
      RETURNING next_value - 1 AS value
    `;

    if (!row) {
      throw new InternalServerErrorException(
        'A protected business reference could not be allocated.',
      );
    }

    const value = totalNumber(row.value);

    if (!Number.isSafeInteger(value) || value < 1 || value > 999_999_999_999) {
      throw new InternalServerErrorException(
        'The organisation business reference range is exhausted.',
      );
    }

    return `${prefix}-${String(value).padStart(6, '0')}`;
  }

  private async findConversionByKey(
    transaction: Transaction,
    organisationId: string,
    idempotencyKey: string,
  ): Promise<ConversionRow | null> {
    const [row] = await transaction.$queryRaw<ConversionRow[]>`
      SELECT
        conversion.enquiry_id AS "enquiryId",
        conversion.client_id AS "clientId",
        conversion.matter_id AS "matterId",
        conversion.idempotency_key AS "idempotencyKey",
        client.client_number AS "clientNumber",
        matter.matter_number AS "matterNumber"
      FROM public.enquiry_conversions AS conversion
      JOIN public.clients AS client
        ON client.id = conversion.client_id
       AND client.organisation_id = conversion.organisation_id
      JOIN public.matters AS matter
        ON matter.id = conversion.matter_id
       AND matter.organisation_id = conversion.organisation_id
      WHERE conversion.organisation_id = ${organisationId}::uuid
        AND conversion.idempotency_key = ${idempotencyKey}::uuid
    `;

    return row ?? null;
  }

  private async findConversionByEnquiry(
    transaction: Transaction,
    organisationId: string,
    enquiryId: string,
  ): Promise<ConversionRow | null> {
    const [row] = await transaction.$queryRaw<ConversionRow[]>`
      SELECT
        conversion.enquiry_id AS "enquiryId",
        conversion.client_id AS "clientId",
        conversion.matter_id AS "matterId",
        conversion.idempotency_key AS "idempotencyKey",
        client.client_number AS "clientNumber",
        matter.matter_number AS "matterNumber"
      FROM public.enquiry_conversions AS conversion
      JOIN public.clients AS client
        ON client.id = conversion.client_id
       AND client.organisation_id = conversion.organisation_id
      JOIN public.matters AS matter
        ON matter.id = conversion.matter_id
       AND matter.organisation_id = conversion.organisation_id
      WHERE conversion.organisation_id = ${organisationId}::uuid
        AND conversion.enquiry_id = ${enquiryId}::uuid
    `;

    return row ?? null;
  }

  private conversionResult(
    row: ConversionRow,
    repeated: boolean,
  ): EnquiryConversionResult {
    return {
      enquiryId: row.enquiryId,
      clientId: row.clientId,
      matterId: row.matterId,
      clientNumber: row.clientNumber,
      matterNumber: row.matterNumber,
      repeated,
    };
  }

  private validateClientIdentity(
    kind: ClientKind,
    value: {
      firstName?: string | null;
      lastName?: string | null;
      organisationName?: string | null;
      email?: string | null;
      phone?: string | null;
      dateOfBirth?: string | null;
    },
  ): void {
    if (!value.email?.trim() && !value.phone?.trim()) {
      throw new BadRequestException(
        'An email address or telephone number is required for the client.',
      );
    }

    if (kind === 'INDIVIDUAL' && !value.firstName?.trim()) {
      throw new BadRequestException('An individual client requires a first name.');
    }

    if (kind === 'ORGANISATION') {
      if (!value.organisationName?.trim()) {
        throw new BadRequestException(
          'An organisation client requires its legal or trading name.',
        );
      }

      if (value.firstName || value.lastName || value.dateOfBirth) {
        throw new BadRequestException(
          'Organisation clients cannot contain individual identity fields.',
        );
      }
    }
  }

  private validateClientPrivacy(value: {
    privacyNoticeVersion?: string | null;
    privacyNoticeAcknowledgedAt?: string | null;
    marketingConsent?: boolean;
    marketingConsentAt?: string | null;
    marketingConsentSource?: string | null;
    identityVerificationStatus?: string;
    identityVerifiedAt?: string | null;
    identityVerificationExpiresAt?: string | null;
  }): void {
    this.validatePrivacyPair(
      value.privacyNoticeVersion ?? null,
      value.privacyNoticeAcknowledgedAt ?? null,
    );

    if (
      value.marketingConsent &&
      (!value.marketingConsentAt || !value.marketingConsentSource?.trim())
    ) {
      throw new BadRequestException(
        'Marketing consent requires its timestamp and recorded source.',
      );
    }

    if (
      value.identityVerificationStatus === 'VERIFIED' &&
      !value.identityVerifiedAt
    ) {
      throw new BadRequestException(
        'Verified identity status requires the verification timestamp.',
      );
    }

    if (
      value.identityVerifiedAt &&
      value.identityVerificationExpiresAt &&
      new Date(value.identityVerificationExpiresAt) <=
        new Date(value.identityVerifiedAt)
    ) {
      throw new BadRequestException(
        'Identity verification expiry must be after verification.',
      );
    }
  }

  private validatePrivacyPair(
    version: string | null,
    acknowledgedAt: string | null,
  ): void {
    if (Boolean(version) !== Boolean(acknowledgedAt)) {
      throw new BadRequestException(
        'Privacy notice version and acknowledgement time must be recorded together.',
      );
    }
  }

  private validateNextAction(
    summary: string | null | undefined,
    at: string | null | undefined,
  ): void {
    if (Boolean(summary?.trim()) !== Boolean(at)) {
      throw new BadRequestException(
        'Next action summary and date must be provided together.',
      );
    }
  }

  private assertMatterTransition(from: MatterStatus, to: MatterStatus): void {
    if (from === to) {
      throw new ConflictException('The matter is already in that status.');
    }

    if (!MATTER_TRANSITIONS[from].includes(to)) {
      throw new ConflictException(
        `Matter status cannot move from ${from} to ${to}.`,
      );
    }
  }

  private assertComplianceGate(
    targetStatus: MatterStatus,
    compliance: ComplianceRow,
  ): void {
    if (
      targetStatus === 'CLIENT_CARE' &&
      !['CLEARED', 'WAIVED'].includes(compliance.conflictStatus)
    ) {
      throw new ConflictException(
        'Conflict checking must be cleared or formally waived before client care.',
      );
    }

    if (
      ['ACTIVE', 'SUBMITTED'].includes(targetStatus) &&
      !this.complianceAllowsActiveWork(compliance)
    ) {
      throw new ConflictException(
        'Conflict, client-care and AML controls must be complete before active work.',
      );
    }
  }

  private complianceAllowsActiveWork(value: {
    conflictStatus: string;
    amlStatus: string;
    clientCareStatus: string;
  }): boolean {
    return (
      ['CLEARED', 'WAIVED'].includes(value.conflictStatus) &&
      ['VERIFIED', 'NOT_REQUIRED'].includes(value.amlStatus) &&
      value.clientCareStatus === 'ACCEPTED'
    );
  }

  private assertVersion(current: number, expected: number): void {
    if (current !== expected) {
      throw new ConflictException(
        'This record was changed by another request. Refresh it before saving.',
      );
    }
  }

  private assertSingleUpdate(count: number): void {
    if (count !== 1) {
      throw new ConflictException(
        'The record changed while it was being saved. Refresh and retry.',
      );
    }
  }

  private countryCode(value: string | null): string | null {
    const candidate = value?.trim().toUpperCase() ?? '';
    return /^[A-Z]{2}$/.test(candidate) ? candidate : null;
  }

  private rlsContext(context: Readonly<OrganisationAccessContext>) {
    return {
      userId: context.userId,
      organisationId: context.organisationId,
      aal: context.aal,
    } as const;
  }

  private async writeAudit(
    transaction: Transaction,
    context: Readonly<OrganisationAccessContext>,
    action: string,
    resourceType: string,
    resourceId: string,
    previousValue: unknown,
    newValue: unknown,
    metadata: unknown = null,
  ): Promise<void> {
    const previousJson =
      previousValue === null ? null : JSON.stringify(previousValue);
    const newJson = newValue === null ? null : JSON.stringify(newValue);
    const metadataJson = metadata === null ? null : JSON.stringify(metadata);

    await transaction.$executeRaw`
      INSERT INTO public.audit_events (
        id, organisation_id, actor_type, actor_user_profile_id,
        source, action, resource_type, resource_id,
        outcome, previous_value, new_value, metadata
      )
      VALUES (
        pg_catalog.gen_random_uuid(), ${context.organisationId}::uuid,
        'USER'::public.audit_actor_type, ${context.userId}::uuid,
        'businessos-api', ${action},
        ${resourceType}, ${resourceId}, 'SUCCESS'::public.audit_outcome,
        ${previousJson}::jsonb, ${newJson}::jsonb, ${metadataJson}::jsonb
      )
    `;
  }

  private async runSafely<T>(
    operation: string,
    callback: () => Promise<T>,
  ): Promise<T> {
    try {
      return await callback();
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      const code = databaseCode(error);

      if (code === 'P2002' || code === '23505') {
        throw new ConflictException(
          'A protected client, matter or business reference already exists.',
        );
      }

      if (code === '40001' || code === 'P2034') {
        throw new ConflictException(
          'The record changed during this operation. Refresh and retry.',
        );
      }

      if (
        code === 'P2003' ||
        code === 'P2004' ||
        code === '23503' ||
        code === '23514' ||
        code === '42501'
      ) {
        throw new BadRequestException(
          'The operation conflicts with an active access, compliance or lifecycle control.',
        );
      }

      if (code === 'P2025') {
        throw new NotFoundException('Case-management record not found.');
      }

      this.logger.error(
        `Case-management operation failed; operation=${operation}; databaseCode=${code ?? 'unknown'}; errorType=${
          error instanceof Error ? error.name : typeof error
        }`,
        error instanceof Error ? error.stack : undefined,
      );

      throw new InternalServerErrorException(
        'The case-management operation could not be completed.',
      );
    }
  }
}