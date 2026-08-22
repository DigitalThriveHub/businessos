import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import type { OrganisationAccessContext } from '../auth/request-security-context';
import { RlsTransactionService } from '../database/rls-transaction.service';
import {
  CreateFinanceDocumentDto,
  IssueFinanceDocumentDto,
  RecordFinancePaymentDto,
  UpdateFinanceSettingsDto,
  VoidFinanceDocumentDto,
} from './dto/finance.dto';
import type { FinanceDashboardRow, FinanceRecord } from './finance.types';

type CalculatedLine = CreateFinanceDocumentDto['lines'][number] & {
  position: number;
  netMinor: bigint;
  taxMinor: bigint;
  grossMinor: bigint;
};

function isRecord(value: unknown): value is FinanceRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function postgresCode(error: unknown, depth = 0): string | undefined {
  if (!isRecord(error) || depth > 6) return undefined;

  for (const key of ['originalCode', 'sqlState', 'sqlstate']) {
    const value = error[key];
    if (typeof value === 'string' && /^[0-9A-Z]{5}$/.test(value)) return value;
  }

  for (const key of [
    'cause',
    'meta',
    'driverAdapterError',
    'originalError',
    'error',
  ]) {
    const code = postgresCode(error[key], depth + 1);
    if (code) return code;
  }

  return typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)
    ? error.code
    : undefined;
}

function calculateLines(dto: CreateFinanceDocumentDto): CalculatedLine[] {
  return dto.lines.map((line, index) => {
    if (
      ['ZERO', 'EXEMPT', 'OUTSIDE_SCOPE'].includes(line.taxCategory) &&
      line.vatRateBasisPoints !== 0
    ) {
      throw new BadRequestException(
        'Zero, exempt and outside-scope lines must use a zero VAT rate.',
      );
    }

    if (
      ['STANDARD', 'REDUCED'].includes(line.taxCategory) &&
      line.vatRateBasisPoints === 0
    ) {
      throw new BadRequestException(
        'Taxable lines must include the applied VAT rate.',
      );
    }

    const quantity = BigInt(line.quantityMilli);
    const unitAmount = BigInt(line.unitAmountMinor);
    const netMinor = (quantity * unitAmount + 500n) / 1_000n;
    const taxMinor =
      (netMinor * BigInt(line.vatRateBasisPoints) + 5_000n) / 10_000n;
    const grossMinor = netMinor + taxMinor;

    if (grossMinor <= 0n || grossMinor > 100_000_000_000n) {
      throw new BadRequestException(
        'Each finance line must have a valid positive total.',
      );
    }

    return {
      ...line,
      position: index + 1,
      netMinor,
      taxMinor,
      grossMinor,
    };
  });
}

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  constructor(private readonly rls: RlsTransactionService) {}

  getDashboard(context: Readonly<OrganisationAccessContext>): Promise<unknown> {
    return this.runSafely('dashboard.read', async () => {
      const rows = await this.rls.run(
        this.rlsContext(context),
        (transaction) =>
          transaction.$queryRaw<FinanceDashboardRow[]>`
            SELECT private.get_finance_dashboard() AS dashboard
          `,
      );

      if (rows.length !== 1 || rows[0]?.dashboard === undefined) {
        throw new InternalServerErrorException(
          'The finance dashboard returned an invalid response.',
        );
      }

      return rows[0].dashboard;
    });
  }

  updateSettings(
    dto: UpdateFinanceSettingsDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<FinanceRecord> {
    return this.runSafely('settings.update', async () => {
      const rows = await this.rls.run(
        this.rlsContext(context),
        (transaction) => transaction.$queryRaw<FinanceRecord[]>`
          UPDATE public.finance_settings
          SET legal_name = ${dto.legalName ?? null},
              address_line_1 = ${dto.addressLine1 ?? null},
              address_line_2 = ${dto.addressLine2 ?? null},
              city = ${dto.city ?? null},
              region = ${dto.region ?? null},
              postal_code = ${dto.postalCode ?? null},
              country_code = ${dto.countryCode},
              vat_scheme = ${dto.vatScheme}::public.finance_vat_scheme,
              vat_registration_number = ${
                dto.vatScheme === 'NOT_REGISTERED'
                  ? null
                  : (dto.vatRegistrationNumber ?? null)
              },
              base_currency = ${dto.baseCurrency},
              invoice_prefix = ${dto.invoicePrefix},
              credit_note_prefix = ${dto.creditNotePrefix},
              payment_prefix = ${dto.paymentPrefix},
              payment_terms_days = ${dto.paymentTermsDays},
              payment_instructions = ${dto.paymentInstructions ?? null},
              updated_by_user_id = ${context.userId}::uuid,
              version = version + 1,
              updated_at = pg_catalog.now()
          WHERE organisation_id = ${context.organisationId}::uuid
            AND version = ${dto.expectedVersion}
          RETURNING
            id, organisation_id AS "organisationId",
            legal_name AS "legalName", address_line_1 AS "addressLine1",
            address_line_2 AS "addressLine2", city, region,
            postal_code AS "postalCode", country_code AS "countryCode",
            vat_scheme::text AS "vatScheme",
            vat_registration_number AS "vatRegistrationNumber",
            base_currency AS "baseCurrency", invoice_prefix AS "invoicePrefix",
            credit_note_prefix AS "creditNotePrefix",
            payment_prefix AS "paymentPrefix",
            payment_terms_days AS "paymentTermsDays",
            payment_instructions AS "paymentInstructions",
            version, updated_at AS "updatedAt"
        `,
      );

      return this.requireOne(rows, 'finance settings');
    });
  }

  createDocument(
    dto: CreateFinanceDocumentDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<unknown> {
    return this.runSafely('document.create', async () => {
      const lines = calculateLines(dto);
      const subtotalMinor = lines.reduce(
        (total, line) => total + line.netMinor,
        0n,
      );
      const taxMinor = lines.reduce((total, line) => total + line.taxMinor, 0n);
      const totalMinor = subtotalMinor + taxMinor;

      if (totalMinor <= 0n || totalMinor > 100_000_000_000n) {
        throw new BadRequestException(
          'The finance document total is outside the supported range.',
        );
      }

      if (dto.documentType === 'CREDIT_NOTE' && !dto.relatedDocumentId) {
        throw new BadRequestException(
          'A credit note must reference its original invoice.',
        );
      }

      const documentId = randomUUID();

      return this.rls.run(this.rlsContext(context), async (transaction) => {
        await transaction.$executeRaw`
            INSERT INTO public.finance_documents (
              id, organisation_id, client_id, matter_id, document_type,
              related_document_id, currency_code, issue_date, due_date,
              reference, notes, subtotal_minor, tax_minor, total_minor,
              balance_minor, client_visible, created_by_user_id,
              updated_by_user_id
            ) VALUES (
              ${documentId}::uuid, ${context.organisationId}::uuid,
              ${dto.clientId}::uuid, ${dto.matterId ?? null}::uuid,
              ${dto.documentType}::public.finance_document_type,
              ${dto.relatedDocumentId ?? null}::uuid, ${dto.currencyCode},
              ${dto.issueDate ?? null}::date, ${dto.dueDate ?? null}::date,
              ${dto.reference ?? null}, ${dto.notes ?? null},
              ${subtotalMinor.toString()}::bigint,
              ${taxMinor.toString()}::bigint,
              ${totalMinor.toString()}::bigint,
              ${totalMinor.toString()}::bigint,
              ${dto.clientVisible ?? true}, ${context.userId}::uuid,
              ${context.userId}::uuid
            )
          `;

        for (const line of lines) {
          await transaction.$executeRaw`
              INSERT INTO public.finance_document_lines (
                id, organisation_id, document_id, position, description,
                quantity_milli, unit_amount_minor, tax_category,
                vat_rate_basis_points, net_minor, tax_minor, gross_minor
              ) VALUES (
                ${randomUUID()}::uuid, ${context.organisationId}::uuid,
                ${documentId}::uuid, ${line.position}, ${line.description},
                ${line.quantityMilli}, ${line.unitAmountMinor}::bigint,
                ${line.taxCategory}::public.finance_tax_category,
                ${line.vatRateBasisPoints}, ${line.netMinor.toString()}::bigint,
                ${line.taxMinor.toString()}::bigint,
                ${line.grossMinor.toString()}::bigint
              )
            `;
        }

        const rows = await transaction.$queryRaw<Array<{ document: unknown }>>`
            SELECT private.finance_document_payload(
              ${documentId}::uuid
            ) AS document
          `;

        if (rows.length !== 1 || rows[0]?.document === undefined) {
          throw new InternalServerErrorException(
            'The finance document could not be returned safely.',
          );
        }

        return rows[0].document;
      });
    });
  }

  issueDocument(
    documentId: string,
    dto: IssueFinanceDocumentDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<unknown> {
    return this.runSafely('document.issue', async () => {
      const rows = await this.rls.run(
        this.rlsContext(context),
        (transaction) =>
          transaction.$queryRaw<Array<{ document: unknown }>>`
            SELECT private.issue_finance_document(
              ${documentId}::uuid,
              ${dto.expectedVersion}
            ) AS document
          `,
      );

      return this.requirePayload(rows, 'document');
    });
  }

  voidDocument(
    documentId: string,
    dto: VoidFinanceDocumentDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<unknown> {
    return this.runSafely('document.void', async () => {
      const rows = await this.rls.run(
        this.rlsContext(context),
        (transaction) =>
          transaction.$queryRaw<Array<{ document: unknown }>>`
            SELECT private.void_finance_document(
              ${documentId}::uuid,
              ${dto.expectedVersion},
              ${dto.reason}
            ) AS document
          `,
      );

      return this.requirePayload(rows, 'document');
    });
  }

  recordPayment(
    dto: RecordFinancePaymentDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<unknown> {
    return this.runSafely('payment.record', async () => {
      const allocationTotal = dto.allocations.reduce(
        (total, allocation) => total + BigInt(allocation.amountMinor),
        0n,
      );

      if (allocationTotal !== BigInt(dto.amountMinor)) {
        throw new BadRequestException(
          'Payment allocations must equal the payment amount.',
        );
      }

      if (
        new Set(dto.allocations.map((allocation) => allocation.documentId))
          .size !== dto.allocations.length
      ) {
        throw new BadRequestException(
          'A finance document can only be allocated once per payment.',
        );
      }

      const input = {
        clientId: dto.clientId,
        paymentType: dto.paymentType,
        method: dto.method,
        currencyCode: dto.currencyCode,
        amountMinor: String(dto.amountMinor),
        occurredAt: dto.occurredAt,
        reference: dto.reference ?? null,
        provider: dto.provider ?? null,
        providerReference: dto.providerReference ?? null,
        relatedPaymentId: dto.relatedPaymentId ?? null,
        idempotencyKey: dto.idempotencyKey,
        allocations: dto.allocations.map((allocation) => ({
          documentId: allocation.documentId,
          amountMinor: String(allocation.amountMinor),
        })),
      };

      const rows = await this.rls.run(
        this.rlsContext(context),
        (transaction) =>
          transaction.$queryRaw<Array<{ payment: unknown }>>`
            SELECT private.record_finance_payment(
              ${JSON.stringify(input)}::jsonb
            ) AS payment
          `,
      );

      return this.requirePayload(rows, 'payment');
    });
  }

  private rlsContext(context: Readonly<OrganisationAccessContext>) {
    return {
      userId: context.userId,
      organisationId: context.organisationId,
      aal: context.aal,
    } as const;
  }

  private requireOne<T>(rows: T[], resource: string): T {
    if (rows.length !== 1 || !rows[0]) {
      throw new ConflictException(
        `The ${resource} changed before the operation completed.`,
      );
    }
    return rows[0];
  }

  private requirePayload<T extends Record<string, unknown>>(
    rows: T[],
    key: keyof T,
  ): unknown {
    const row = this.requireOne(rows, String(key));
    const value = row[key];
    if (value === undefined || value === null) {
      throw new InternalServerErrorException(
        'The finance operation returned an invalid response.',
      );
    }
    return value;
  }

  private async runSafely<T>(operation: string, action: () => Promise<T>) {
    try {
      return await action();
    } catch (error: unknown) {
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof ForbiddenException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      const code = postgresCode(error);
      if (code === '42501') {
        throw new ForbiddenException(
          'You do not have permission to perform this finance action.',
        );
      }
      if (code === 'P0002' || code === '02000') {
        throw new NotFoundException(
          'The requested finance record was not found.',
        );
      }
      if (['23505', '23P01', '40001', '55000'].includes(code ?? '')) {
        throw new ConflictException(
          'The finance record changed or already exists.',
        );
      }
      if (['22003', '22007', '22023', '23503', '23514'].includes(code ?? '')) {
        throw new BadRequestException(
          'The finance request is invalid in its current state.',
        );
      }

      this.logger.error(
        `Finance operation failed; operation=${operation}; databaseCode=${
          code ?? 'unknown'
        }; errorType=${error instanceof Error ? error.name : typeof error}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException(
        'The finance service is temporarily unavailable.',
      );
    }
  }
}
