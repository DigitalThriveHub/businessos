-- Gate E: tenant-isolated UK billing, payment allocation and accounting evidence.
-- Monetary values are integer minor units. Posted journals and payment evidence
-- are append-only; all mutations are authorised from verified application context.

BEGIN;

CREATE TYPE public.finance_vat_scheme AS ENUM (
  'NOT_REGISTERED', 'STANDARD', 'CASH_ACCOUNTING', 'FLAT_RATE'
);
CREATE TYPE public.finance_tax_category AS ENUM (
  'STANDARD', 'REDUCED', 'ZERO', 'EXEMPT', 'OUTSIDE_SCOPE'
);
CREATE TYPE public.finance_document_type AS ENUM ('INVOICE', 'CREDIT_NOTE');
CREATE TYPE public.finance_document_status AS ENUM (
  'DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID'
);
CREATE TYPE public.finance_payment_type AS ENUM ('RECEIPT', 'REFUND');
CREATE TYPE public.finance_payment_method AS ENUM (
  'BANK_TRANSFER', 'CARD', 'CASH', 'DIRECT_DEBIT', 'CHEQUE', 'OTHER'
);
CREATE TYPE public.finance_payment_status AS ENUM ('CLEARED', 'REVERSED');
CREATE TYPE public.finance_ledger_account_type AS ENUM (
  'ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'
);
CREATE TYPE public.finance_journal_source AS ENUM (
  'INVOICE', 'CREDIT_NOTE', 'PAYMENT', 'REFUND', 'REVERSAL'
);

CREATE TABLE public.finance_settings (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  legal_name varchar(250),
  address_line_1 varchar(240),
  address_line_2 varchar(240),
  city varchar(120),
  region varchar(120),
  postal_code varchar(30),
  country_code char(2) NOT NULL DEFAULT 'GB',
  vat_scheme public.finance_vat_scheme NOT NULL DEFAULT 'NOT_REGISTERED',
  vat_registration_number varchar(32),
  base_currency char(3) NOT NULL DEFAULT 'GBP',
  invoice_prefix varchar(12) NOT NULL DEFAULT 'INV',
  credit_note_prefix varchar(12) NOT NULL DEFAULT 'CRN',
  payment_prefix varchar(12) NOT NULL DEFAULT 'PAY',
  payment_terms_days integer NOT NULL DEFAULT 14,
  payment_instructions varchar(2000),
  version integer NOT NULL DEFAULT 1,
  updated_by_user_id uuid,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_finance_settings PRIMARY KEY (id),
  CONSTRAINT uq_finance_settings_org UNIQUE (organisation_id),
  CONSTRAINT fk_finance_settings_org FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_finance_settings_actor FOREIGN KEY (updated_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_finance_settings_country CHECK (country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT ck_finance_settings_currency CHECK (base_currency ~ '^[A-Z]{3}$'),
  CONSTRAINT ck_finance_settings_prefixes CHECK (
    invoice_prefix ~ '^[A-Z][A-Z0-9-]{1,11}$'
    AND credit_note_prefix ~ '^[A-Z][A-Z0-9-]{1,11}$'
    AND payment_prefix ~ '^[A-Z][A-Z0-9-]{1,11}$'
  ),
  CONSTRAINT ck_finance_settings_terms CHECK (payment_terms_days BETWEEN 0 AND 365),
  CONSTRAINT ck_finance_settings_version CHECK (version > 0),
  CONSTRAINT ck_finance_settings_vat CHECK (
    (vat_scheme = 'NOT_REGISTERED' AND vat_registration_number IS NULL)
    OR
    (vat_scheme <> 'NOT_REGISTERED'
      AND vat_registration_number IS NOT NULL
      AND char_length(btrim(vat_registration_number)) BETWEEN 3 AND 32)
  )
);

CREATE TABLE public.finance_ledger_accounts (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  code varchar(20) NOT NULL,
  name varchar(160) NOT NULL,
  account_type public.finance_ledger_account_type NOT NULL,
  system_key varchar(40),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_finance_ledger_accounts PRIMARY KEY (id),
  CONSTRAINT fk_finance_accounts_org FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_finance_accounts_org_code UNIQUE (organisation_id, code),
  CONSTRAINT uq_finance_accounts_org_system UNIQUE (organisation_id, system_key),
  CONSTRAINT uq_finance_accounts_id_org UNIQUE (id, organisation_id),
  CONSTRAINT ck_finance_accounts_code CHECK (code ~ '^[0-9A-Z][0-9A-Z.-]{0,19}$'),
  CONSTRAINT ck_finance_accounts_name CHECK (
    name = btrim(name) AND char_length(name) BETWEEN 1 AND 160
  )
);

CREATE INDEX ix_finance_accounts_org_type
  ON public.finance_ledger_accounts (organisation_id, account_type, active);

CREATE TABLE public.finance_documents (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  client_id uuid NOT NULL,
  matter_id uuid,
  document_type public.finance_document_type NOT NULL,
  status public.finance_document_status NOT NULL DEFAULT 'DRAFT',
  document_number varchar(40),
  related_document_id uuid,
  currency_code char(3) NOT NULL DEFAULT 'GBP',
  issue_date date,
  due_date date,
  reference varchar(120),
  notes varchar(2000),
  seller_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  customer_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  subtotal_minor bigint NOT NULL DEFAULT 0,
  tax_minor bigint NOT NULL DEFAULT 0,
  total_minor bigint NOT NULL DEFAULT 0,
  allocated_minor bigint NOT NULL DEFAULT 0,
  credited_minor bigint NOT NULL DEFAULT 0,
  balance_minor bigint NOT NULL DEFAULT 0,
  client_visible boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  issued_at timestamptz(6),
  issued_by_user_id uuid,
  voided_at timestamptz(6),
  voided_by_user_id uuid,
  void_reason varchar(1000),
  created_by_user_id uuid NOT NULL,
  updated_by_user_id uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_finance_documents PRIMARY KEY (id),
  CONSTRAINT fk_finance_documents_org FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_finance_documents_client FOREIGN KEY (client_id, organisation_id)
    REFERENCES public.clients (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_finance_documents_matter FOREIGN KEY (matter_id, organisation_id)
    REFERENCES public.matters (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_finance_documents_related FOREIGN KEY (
    related_document_id, organisation_id
  ) REFERENCES public.finance_documents (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_finance_documents_issued_by FOREIGN KEY (issued_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_finance_documents_voided_by FOREIGN KEY (voided_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_finance_documents_created_by FOREIGN KEY (created_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_finance_documents_updated_by FOREIGN KEY (updated_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_finance_documents_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_finance_documents_org_number UNIQUE (organisation_id, document_number),
  CONSTRAINT ck_finance_documents_currency CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT ck_finance_documents_dates CHECK (
    due_date IS NULL OR issue_date IS NULL OR due_date >= issue_date
  ),
  CONSTRAINT ck_finance_documents_related CHECK (
    (document_type = 'INVOICE' AND related_document_id IS NULL)
    OR (document_type = 'CREDIT_NOTE' AND related_document_id IS NOT NULL)
  ),
  CONSTRAINT ck_finance_documents_amounts CHECK (
    subtotal_minor >= 0 AND tax_minor >= 0 AND total_minor > 0
    AND total_minor = subtotal_minor + tax_minor
    AND allocated_minor >= 0 AND credited_minor >= 0 AND balance_minor >= 0
    AND allocated_minor + credited_minor <= total_minor
  ),
  CONSTRAINT ck_finance_documents_version CHECK (version > 0),
  CONSTRAINT ck_finance_documents_lifecycle CHECK (
    (status = 'DRAFT' AND document_number IS NULL AND issued_at IS NULL
      AND issued_by_user_id IS NULL AND voided_at IS NULL
      AND voided_by_user_id IS NULL AND void_reason IS NULL)
    OR
    (status IN ('ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE')
      AND document_number IS NOT NULL AND issue_date IS NOT NULL
      AND issued_at IS NOT NULL AND issued_by_user_id IS NOT NULL
      AND voided_at IS NULL AND voided_by_user_id IS NULL AND void_reason IS NULL)
    OR
    (status = 'VOID' AND voided_at IS NOT NULL
      AND voided_by_user_id IS NOT NULL AND void_reason IS NOT NULL)
  )
);

CREATE INDEX ix_finance_documents_org_status_due
  ON public.finance_documents (organisation_id, status, due_date);
CREATE INDEX ix_finance_documents_org_client
  ON public.finance_documents (organisation_id, client_id, created_at DESC);
CREATE INDEX ix_finance_documents_org_matter
  ON public.finance_documents (organisation_id, matter_id, created_at DESC);

CREATE TABLE public.finance_document_lines (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  document_id uuid NOT NULL,
  position integer NOT NULL,
  description varchar(500) NOT NULL,
  quantity_milli integer NOT NULL,
  unit_amount_minor bigint NOT NULL,
  tax_category public.finance_tax_category NOT NULL,
  vat_rate_basis_points integer NOT NULL,
  net_minor bigint NOT NULL,
  tax_minor bigint NOT NULL,
  gross_minor bigint NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_finance_document_lines PRIMARY KEY (id),
  CONSTRAINT fk_finance_lines_document FOREIGN KEY (document_id, organisation_id)
    REFERENCES public.finance_documents (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_finance_lines_document_position UNIQUE (document_id, position),
  CONSTRAINT uq_finance_lines_id_org UNIQUE (id, organisation_id),
  CONSTRAINT ck_finance_lines_position CHECK (position BETWEEN 1 AND 100),
  CONSTRAINT ck_finance_lines_description CHECK (
    description = btrim(description) AND char_length(description) BETWEEN 1 AND 500
  ),
  CONSTRAINT ck_finance_lines_quantity CHECK (quantity_milli BETWEEN 1 AND 1000000),
  CONSTRAINT ck_finance_lines_rate CHECK (vat_rate_basis_points BETWEEN 0 AND 10000),
  CONSTRAINT ck_finance_lines_tax_category CHECK (
    (tax_category IN ('ZERO', 'EXEMPT', 'OUTSIDE_SCOPE') AND vat_rate_basis_points = 0)
    OR (tax_category IN ('STANDARD', 'REDUCED') AND vat_rate_basis_points > 0)
  ),
  CONSTRAINT ck_finance_lines_amounts CHECK (
    unit_amount_minor >= 0 AND net_minor > 0 AND tax_minor >= 0
    AND gross_minor = net_minor + tax_minor
  )
);

CREATE INDEX ix_finance_lines_org_document
  ON public.finance_document_lines (organisation_id, document_id, position);

CREATE TABLE public.finance_payments (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  client_id uuid NOT NULL,
  payment_number varchar(40) NOT NULL,
  payment_type public.finance_payment_type NOT NULL,
  method public.finance_payment_method NOT NULL,
  status public.finance_payment_status NOT NULL DEFAULT 'CLEARED',
  currency_code char(3) NOT NULL DEFAULT 'GBP',
  amount_minor bigint NOT NULL,
  occurred_at timestamptz(6) NOT NULL,
  reference varchar(240),
  provider varchar(80),
  provider_reference varchar(240),
  related_payment_id uuid,
  idempotency_key varchar(180) NOT NULL,
  recorded_by_user_id uuid NOT NULL,
  reversed_at timestamptz(6),
  reversed_by_user_id uuid,
  reversal_reason varchar(1000),
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_finance_payments PRIMARY KEY (id),
  CONSTRAINT fk_finance_payments_org FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_finance_payments_client FOREIGN KEY (client_id, organisation_id)
    REFERENCES public.clients (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_finance_payments_related FOREIGN KEY (
    related_payment_id, organisation_id
  ) REFERENCES public.finance_payments (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_finance_payments_actor FOREIGN KEY (recorded_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_finance_payments_reversed_by FOREIGN KEY (reversed_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_finance_payments_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_finance_payments_org_number UNIQUE (organisation_id, payment_number),
  CONSTRAINT uq_finance_payments_org_idempotency UNIQUE (organisation_id, idempotency_key),
  CONSTRAINT ck_finance_payments_currency CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT ck_finance_payments_amount CHECK (amount_minor > 0),
  CONSTRAINT ck_finance_payments_related CHECK (
    (payment_type = 'RECEIPT' AND related_payment_id IS NULL)
    OR (payment_type = 'REFUND' AND related_payment_id IS NOT NULL)
  ),
  CONSTRAINT ck_finance_payments_reversal CHECK (
    (status = 'CLEARED' AND reversed_at IS NULL
      AND reversed_by_user_id IS NULL AND reversal_reason IS NULL)
    OR
    (status = 'REVERSED' AND reversed_at IS NOT NULL
      AND reversed_by_user_id IS NOT NULL AND reversal_reason IS NOT NULL)
  )
);

CREATE INDEX ix_finance_payments_org_client
  ON public.finance_payments (organisation_id, client_id, occurred_at DESC);

CREATE TABLE public.finance_payment_allocations (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  document_id uuid NOT NULL,
  amount_minor bigint NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_finance_payment_allocations PRIMARY KEY (id),
  CONSTRAINT fk_finance_allocations_payment FOREIGN KEY (payment_id, organisation_id)
    REFERENCES public.finance_payments (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_finance_allocations_document FOREIGN KEY (document_id, organisation_id)
    REFERENCES public.finance_documents (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_finance_allocations_payment_document UNIQUE (payment_id, document_id),
  CONSTRAINT uq_finance_allocations_id_org UNIQUE (id, organisation_id),
  CONSTRAINT ck_finance_allocations_amount CHECK (amount_minor > 0)
);

CREATE INDEX ix_finance_allocations_org_document
  ON public.finance_payment_allocations (organisation_id, document_id);

CREATE TABLE public.finance_journal_entries (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  entry_number varchar(40) NOT NULL,
  source public.finance_journal_source NOT NULL,
  source_id uuid NOT NULL,
  entry_date date NOT NULL,
  description varchar(500) NOT NULL,
  reversal_of_id uuid,
  posted_by_user_id uuid NOT NULL,
  posted_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_finance_journal_entries PRIMARY KEY (id),
  CONSTRAINT fk_finance_journals_org FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_finance_journals_reversal FOREIGN KEY (
    reversal_of_id, organisation_id
  ) REFERENCES public.finance_journal_entries (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_finance_journals_actor FOREIGN KEY (posted_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_finance_journals_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_finance_journals_org_number UNIQUE (organisation_id, entry_number),
  CONSTRAINT uq_finance_journals_org_source UNIQUE (organisation_id, source, source_id),
  CONSTRAINT ck_finance_journals_description CHECK (
    description = btrim(description) AND char_length(description) BETWEEN 1 AND 500
  )
);

CREATE INDEX ix_finance_journals_org_date
  ON public.finance_journal_entries (organisation_id, entry_date, posted_at DESC);

CREATE TABLE public.finance_journal_lines (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  journal_entry_id uuid NOT NULL,
  account_id uuid NOT NULL,
  position integer NOT NULL,
  debit_minor bigint NOT NULL DEFAULT 0,
  credit_minor bigint NOT NULL DEFAULT 0,
  description varchar(500),
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_finance_journal_lines PRIMARY KEY (id),
  CONSTRAINT fk_finance_journal_lines_entry FOREIGN KEY (
    journal_entry_id, organisation_id
  ) REFERENCES public.finance_journal_entries (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_finance_journal_lines_account FOREIGN KEY (
    account_id, organisation_id
  ) REFERENCES public.finance_ledger_accounts (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_finance_journal_lines_entry_position UNIQUE (journal_entry_id, position),
  CONSTRAINT uq_finance_journal_lines_id_org UNIQUE (id, organisation_id),
  CONSTRAINT ck_finance_journal_lines_position CHECK (position BETWEEN 1 AND 20),
  CONSTRAINT ck_finance_journal_lines_amount CHECK (
    (debit_minor > 0 AND credit_minor = 0)
    OR (credit_minor > 0 AND debit_minor = 0)
  )
);

CREATE INDEX ix_finance_journal_lines_org_account
  ON public.finance_journal_lines (organisation_id, account_id, created_at);

WITH permission_seed(
  permission_key, permission_name, permission_description,
  resource_name, action_name, is_sensitive, requires_mfa
) AS (
  VALUES
    ('finance.read', 'View finance records',
      'View authorised invoices, payments and finance summaries.',
      'finance', 'read', true, false),
    ('finance.settings.manage', 'Manage finance settings',
      'Manage legal invoice identity, VAT scheme and payment terms.',
      'finance', 'settings.manage', true, true),
    ('invoices.create', 'Create invoices and credit notes',
      'Create controlled draft invoices and credit notes.',
      'invoices', 'create', true, true),
    ('invoices.issue', 'Issue invoices and credit notes',
      'Allocate sequential references and post immutable accounting evidence.',
      'invoices', 'issue', true, true),
    ('invoices.void', 'Void finance documents',
      'Void eligible documents with a reason and reversal evidence.',
      'invoices', 'void', true, true),
    ('payments.record', 'Record and allocate payments',
      'Record cleared receipts and allocate them to authorised invoices.',
      'payments', 'record', true, true),
    ('payments.refund', 'Record controlled refunds',
      'Record refunds against an original receipt and invoice allocation.',
      'payments', 'refund', true, true),
    ('ledger.read', 'View accounting ledger',
      'View immutable double-entry journal evidence and account balances.',
      'ledger', 'read', true, false)
)
INSERT INTO public.permissions (
  id, key, name, description, resource, action, data_scope,
  is_sensitive, requires_mfa, allows_ai_use, is_active,
  metadata, created_at, updated_at
)
SELECT
  pg_catalog.gen_random_uuid(), permission_key, permission_name,
  permission_description, resource_name, action_name,
  'ORGANISATION'::public.permission_data_scope,
  is_sensitive, requires_mfa, false, true,
  jsonb_build_object(
    'classification', 'financial-confidential',
    'contains_pii', true,
    'ai_default', 'deny',
    'control_family', 'gate-e-finance'
  ),
  pg_catalog.now(), pg_catalog.now()
FROM permission_seed
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  resource = EXCLUDED.resource,
  action = EXCLUDED.action,
  data_scope = EXCLUDED.data_scope,
  is_sensitive = EXCLUDED.is_sensitive,
  requires_mfa = EXCLUDED.requires_mfa,
  allows_ai_use = false,
  is_active = true,
  metadata = EXCLUDED.metadata,
  deleted_at = NULL,
  updated_at = pg_catalog.now();

INSERT INTO public.role_permissions (id, role_id, permission_id, created_at)
SELECT pg_catalog.gen_random_uuid(), role_record.id, permission_record.id,
  pg_catalog.now()
FROM public.roles AS role_record
CROSS JOIN public.permissions AS permission_record
WHERE role_record.key IN ('organisation_owner', 'system_administrator')
  AND role_record.scope = 'ORGANISATION'
  AND role_record.organisation_id IS NOT NULL
  AND role_record.deleted_at IS NULL
  AND permission_record.resource IN ('finance', 'invoices', 'payments', 'ledger')
  AND permission_record.is_active
  AND permission_record.deleted_at IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH role_permission_seed(role_key, permission_key) AS (
  VALUES
    ('finance', 'finance.read'),
    ('finance', 'finance.settings.manage'),
    ('finance', 'invoices.create'),
    ('finance', 'invoices.issue'),
    ('finance', 'invoices.void'),
    ('finance', 'payments.record'),
    ('finance', 'payments.refund'),
    ('finance', 'ledger.read'),
    ('compliance_manager', 'finance.read'),
    ('compliance_manager', 'ledger.read'),
    ('solicitor', 'finance.read'),
    ('solicitor', 'invoices.create'),
    ('case_manager', 'finance.read'),
    ('case_manager', 'invoices.create'),
    ('read_only', 'finance.read'),
    ('read_only', 'ledger.read')
)
INSERT INTO public.role_permissions (id, role_id, permission_id, created_at)
SELECT pg_catalog.gen_random_uuid(), role_record.id, permission_record.id,
  pg_catalog.now()
FROM role_permission_seed
JOIN public.roles AS role_record
  ON role_record.key = role_permission_seed.role_key
 AND role_record.scope = 'ORGANISATION'
 AND role_record.organisation_id IS NOT NULL
 AND role_record.deleted_at IS NULL
JOIN public.permissions AS permission_record
  ON permission_record.key = role_permission_seed.permission_key
 AND permission_record.is_active
 AND permission_record.deleted_at IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;

CREATE OR REPLACE FUNCTION private.provision_finance_defaults(p_organisation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  organisation_record record;
BEGIN
  SELECT organisation.id, organisation.name, organisation.legal_name,
    organisation.country_code
  INTO organisation_record
  FROM public.organisations AS organisation
  WHERE organisation.id = p_organisation_id
    AND organisation.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organisation is unavailable' USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO public.finance_settings (
    organisation_id, legal_name, country_code
  ) VALUES (
    organisation_record.id,
    COALESCE(organisation_record.legal_name, organisation_record.name),
    organisation_record.country_code
  ) ON CONFLICT (organisation_id) DO NOTHING;

  INSERT INTO public.finance_ledger_accounts (
    organisation_id, code, name, account_type, system_key
  ) VALUES
    (p_organisation_id, '1000', 'Bank and cash', 'ASSET', 'BANK'),
    (p_organisation_id, '1100', 'Trade debtors', 'ASSET', 'ACCOUNTS_RECEIVABLE'),
    (p_organisation_id, '2200', 'VAT control', 'LIABILITY', 'VAT_CONTROL'),
    (p_organisation_id, '4000', 'Fee income', 'REVENUE', 'FEE_INCOME')
  ON CONFLICT (organisation_id, code) DO NOTHING;
END
$function$;

REVOKE ALL ON FUNCTION private.provision_finance_defaults(uuid)
  FROM PUBLIC, anon, authenticated, service_role, businessos_app;

CREATE OR REPLACE FUNCTION private.provision_finance_defaults_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  PERFORM private.provision_finance_defaults(NEW.id);
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION private.provision_finance_defaults_trigger() FROM PUBLIC;

CREATE TRIGGER organisations_provision_finance_defaults
  AFTER INSERT ON public.organisations
  FOR EACH ROW EXECUTE FUNCTION private.provision_finance_defaults_trigger();

DO $backfill_finance_defaults$
DECLARE
  organisation_record record;
BEGIN
  FOR organisation_record IN
    SELECT id FROM public.organisations WHERE deleted_at IS NULL
  LOOP
    PERFORM private.provision_finance_defaults(organisation_record.id);
  END LOOP;
END
$backfill_finance_defaults$;

ALTER TABLE public.client_portal_access_grants
  DROP CONSTRAINT ck_portal_access_scopes;
ALTER TABLE public.client_portal_access_grants
  ADD CONSTRAINT ck_portal_access_scopes CHECK (
    cardinality(scopes) BETWEEN 1 AND 8
    AND scopes <@ ARRAY[
      'MATTER_PROGRESS', 'DOCUMENTS', 'MESSAGES', 'NOTIFICATIONS', 'BILLING'
    ]::varchar(80)[]
  );
ALTER TABLE public.client_portal_invitations
  DROP CONSTRAINT ck_portal_invitation_scopes;
ALTER TABLE public.client_portal_invitations
  ADD CONSTRAINT ck_portal_invitation_scopes CHECK (
    cardinality(scopes) BETWEEN 1 AND 8
    AND scopes <@ ARRAY[
      'MATTER_PROGRESS', 'DOCUMENTS', 'MESSAGES', 'NOTIFICATIONS', 'BILLING'
    ]::varchar(80)[]
  );

CREATE OR REPLACE FUNCTION private.finance_document_payload(p_document_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  SELECT jsonb_build_object(
    'id', document.id,
    'organisationId', document.organisation_id,
    'clientId', document.client_id,
    'clientName', client.display_name,
    'clientNumber', client.client_number,
    'matterId', document.matter_id,
    'matterNumber', matter.matter_number,
    'documentType', document.document_type,
    'status', CASE
      WHEN document.status IN ('ISSUED', 'PARTIALLY_PAID')
        AND document.balance_minor > 0
        AND document.due_date < CURRENT_DATE THEN 'OVERDUE'
      ELSE document.status::text
    END,
    'documentNumber', document.document_number,
    'relatedDocumentId', document.related_document_id,
    'currencyCode', document.currency_code,
    'issueDate', document.issue_date,
    'dueDate', document.due_date,
    'reference', document.reference,
    'notes', document.notes,
    'sellerSnapshot', document.seller_snapshot,
    'customerSnapshot', document.customer_snapshot,
    'subtotalMinor', document.subtotal_minor::text,
    'taxMinor', document.tax_minor::text,
    'totalMinor', document.total_minor::text,
    'allocatedMinor', document.allocated_minor::text,
    'creditedMinor', document.credited_minor::text,
    'balanceMinor', document.balance_minor::text,
    'clientVisible', document.client_visible,
    'version', document.version,
    'issuedAt', document.issued_at,
    'voidedAt', document.voided_at,
    'voidReason', document.void_reason,
    'createdAt', document.created_at,
    'updatedAt', document.updated_at,
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', line.id,
        'position', line.position,
        'description', line.description,
        'quantityMilli', line.quantity_milli,
        'unitAmountMinor', line.unit_amount_minor::text,
        'taxCategory', line.tax_category,
        'vatRateBasisPoints', line.vat_rate_basis_points,
        'netMinor', line.net_minor::text,
        'taxMinor', line.tax_minor::text,
        'grossMinor', line.gross_minor::text
      ) ORDER BY line.position)
      FROM public.finance_document_lines AS line
      WHERE line.document_id = document.id
        AND line.organisation_id = document.organisation_id
    ), '[]'::jsonb)
  )
  FROM public.finance_documents AS document
  JOIN public.clients AS client
    ON client.id = document.client_id
   AND client.organisation_id = document.organisation_id
  LEFT JOIN public.matters AS matter
    ON matter.id = document.matter_id
   AND matter.organisation_id = document.organisation_id
  WHERE document.id = p_document_id
    AND document.organisation_id = private.current_organisation_id()
$function$;

CREATE OR REPLACE FUNCTION private.finance_payment_payload(p_payment_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT jsonb_build_object(
    'id', payment.id,
    'organisationId', payment.organisation_id,
    'clientId', payment.client_id,
    'clientName', client.display_name,
    'paymentNumber', payment.payment_number,
    'paymentType', payment.payment_type,
    'method', payment.method,
    'status', payment.status,
    'currencyCode', payment.currency_code,
    'amountMinor', payment.amount_minor::text,
    'occurredAt', payment.occurred_at,
    'reference', payment.reference,
    'provider', payment.provider,
    'providerReference', payment.provider_reference,
    'relatedPaymentId', payment.related_payment_id,
    'createdAt', payment.created_at,
    'allocations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'documentId', allocation.document_id,
        'documentNumber', document.document_number,
        'amountMinor', allocation.amount_minor::text
      ) ORDER BY allocation.created_at)
      FROM public.finance_payment_allocations AS allocation
      JOIN public.finance_documents AS document
        ON document.id = allocation.document_id
       AND document.organisation_id = allocation.organisation_id
      WHERE allocation.payment_id = payment.id
        AND allocation.organisation_id = payment.organisation_id
    ), '[]'::jsonb)
  )
  FROM public.finance_payments AS payment
  JOIN public.clients AS client
    ON client.id = payment.client_id
   AND client.organisation_id = payment.organisation_id
  WHERE payment.id = p_payment_id
    AND payment.organisation_id = private.current_organisation_id()
$function$;

CREATE OR REPLACE FUNCTION private.issue_finance_document(
  p_document_id uuid,
  p_expected_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id();
  v_user uuid := private.current_user_id();
  document_record record;
  settings_record record;
  original_record record;
  v_sequence bigint;
  v_journal_sequence bigint;
  v_number text;
  v_journal_id uuid := pg_catalog.gen_random_uuid();
  v_journal_number text;
  v_ar uuid;
  v_revenue uuid;
  v_vat uuid;
BEGIN
  IF v_org IS NULL OR v_user IS NULL
     OR NOT private.has_organisation_permission(v_org, 'invoices.issue') THEN
    RAISE EXCEPTION 'finance issue permission is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO document_record
  FROM public.finance_documents
  WHERE id = p_document_id AND organisation_id = v_org
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'finance document was not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF document_record.status <> 'DRAFT'
     OR document_record.version <> p_expected_version THEN
    RAISE EXCEPTION 'finance document changed or is not draft' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.finance_document_lines
    WHERE document_id = p_document_id AND organisation_id = v_org
  ) THEN
    RAISE EXCEPTION 'finance document has no lines' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO settings_record FROM public.finance_settings
  WHERE organisation_id = v_org;
  IF settings_record.legal_name IS NULL
     OR settings_record.address_line_1 IS NULL
     OR settings_record.city IS NULL
     OR settings_record.postal_code IS NULL THEN
    RAISE EXCEPTION 'finance legal identity is incomplete' USING ERRCODE = '22023';
  END IF;
  IF document_record.currency_code <> settings_record.base_currency THEN
    RAISE EXCEPTION 'document currency must match the organisation base currency'
      USING ERRCODE = '22023';
  END IF;
  IF settings_record.vat_scheme = 'NOT_REGISTERED'
     AND document_record.tax_minor <> 0 THEN
    RAISE EXCEPTION 'VAT cannot be charged while the organisation is not VAT registered'
      USING ERRCODE = '22023';
  END IF;

  IF document_record.document_type = 'CREDIT_NOTE' THEN
    SELECT * INTO original_record
    FROM public.finance_documents
    WHERE id = document_record.related_document_id
      AND organisation_id = v_org
      AND document_type = 'INVOICE'
      AND status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')
    FOR UPDATE;
    IF NOT FOUND OR original_record.client_id <> document_record.client_id
       OR original_record.currency_code <> document_record.currency_code THEN
      RAISE EXCEPTION 'original invoice is unavailable' USING ERRCODE = '22023';
    END IF;
    IF original_record.balance_minor < document_record.total_minor THEN
      RAISE EXCEPTION 'credit note exceeds the invoice balance' USING ERRCODE = '22003';
    END IF;
  END IF;

  INSERT INTO public.organisation_number_sequences (
    organisation_id, key, next_value
  ) VALUES (
    v_org,
    CASE document_record.document_type
      WHEN 'INVOICE' THEN 'FINANCE_INVOICE'
      ELSE 'FINANCE_CREDIT_NOTE'
    END,
    2
  )
  ON CONFLICT (organisation_id, key) DO UPDATE SET
    next_value = public.organisation_number_sequences.next_value + 1,
    updated_at = pg_catalog.now()
  RETURNING next_value - 1 INTO v_sequence;

  v_number := (
    CASE document_record.document_type
      WHEN 'INVOICE' THEN settings_record.invoice_prefix
      ELSE settings_record.credit_note_prefix
    END
  ) || '-' || pg_catalog.lpad(v_sequence::text, 8, '0');

  UPDATE public.finance_documents
  SET document_number = v_number,
      issue_date = COALESCE(issue_date, CURRENT_DATE),
      due_date = CASE
        WHEN document_type = 'CREDIT_NOTE' THEN COALESCE(due_date, issue_date, CURRENT_DATE)
        ELSE COALESCE(
          due_date,
          COALESCE(issue_date, CURRENT_DATE) + settings_record.payment_terms_days
        )
      END,
      seller_snapshot = jsonb_build_object(
        'legalName', settings_record.legal_name,
        'addressLine1', settings_record.address_line_1,
        'addressLine2', settings_record.address_line_2,
        'city', settings_record.city,
        'region', settings_record.region,
        'postalCode', settings_record.postal_code,
        'countryCode', settings_record.country_code,
        'vatScheme', settings_record.vat_scheme,
        'vatRegistrationNumber', settings_record.vat_registration_number,
        'paymentInstructions', settings_record.payment_instructions
      ),
      customer_snapshot = (
        SELECT jsonb_build_object(
          'clientNumber', client.client_number,
          'name', client.display_name,
          'email', client.email,
          'addressLine1', client.address_line_1,
          'addressLine2', client.address_line_2,
          'city', client.city,
          'region', client.region,
          'postalCode', client.postal_code,
          'countryCode', client.address_country_code
        )
        FROM public.clients AS client
        WHERE client.id = document_record.client_id
          AND client.organisation_id = v_org
      ),
      status = CASE document_type WHEN 'CREDIT_NOTE' THEN 'PAID' ELSE 'ISSUED' END,
      balance_minor = CASE document_type WHEN 'CREDIT_NOTE' THEN 0 ELSE total_minor END,
      issued_at = pg_catalog.now(),
      issued_by_user_id = v_user,
      updated_by_user_id = v_user,
      version = version + 1,
      updated_at = pg_catalog.now()
  WHERE id = p_document_id AND organisation_id = v_org;

  IF document_record.document_type = 'CREDIT_NOTE' THEN
    UPDATE public.finance_documents
    SET credited_minor = credited_minor + document_record.total_minor,
        balance_minor = balance_minor - document_record.total_minor,
        status = CASE
          WHEN balance_minor - document_record.total_minor = 0 THEN 'PAID'
          WHEN allocated_minor > 0 OR credited_minor + document_record.total_minor > 0
            THEN 'PARTIALLY_PAID'
          ELSE 'ISSUED'
        END,
        updated_by_user_id = v_user,
        version = version + 1,
        updated_at = pg_catalog.now()
    WHERE id = original_record.id AND organisation_id = v_org;
  END IF;

  SELECT
    (max(id::text) FILTER (WHERE system_key = 'ACCOUNTS_RECEIVABLE'))::uuid,
    (max(id::text) FILTER (WHERE system_key = 'FEE_INCOME'))::uuid,
    (max(id::text) FILTER (WHERE system_key = 'VAT_CONTROL'))::uuid
  INTO v_ar, v_revenue, v_vat
  FROM public.finance_ledger_accounts
  WHERE organisation_id = v_org AND active;
  IF v_ar IS NULL OR v_revenue IS NULL OR v_vat IS NULL THEN
    RAISE EXCEPTION 'finance ledger defaults are unavailable' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.organisation_number_sequences (
    organisation_id, key, next_value
  ) VALUES (v_org, 'FINANCE_JOURNAL', 2)
  ON CONFLICT (organisation_id, key) DO UPDATE SET
    next_value = public.organisation_number_sequences.next_value + 1,
    updated_at = pg_catalog.now()
  RETURNING next_value - 1 INTO v_journal_sequence;
  v_journal_number := 'JRN-' || pg_catalog.lpad(v_journal_sequence::text, 8, '0');

  INSERT INTO public.finance_journal_entries (
    id, organisation_id, entry_number, source, source_id,
    entry_date, description, posted_by_user_id
  ) VALUES (
    v_journal_id, v_org, v_journal_number,
    CASE document_record.document_type
      WHEN 'INVOICE' THEN 'INVOICE'::public.finance_journal_source
      ELSE 'CREDIT_NOTE'::public.finance_journal_source
    END,
    p_document_id, COALESCE(document_record.issue_date, CURRENT_DATE),
    CASE document_record.document_type
      WHEN 'INVOICE' THEN 'Issued invoice ' ELSE 'Issued credit note '
    END || v_number,
    v_user
  );

  IF document_record.document_type = 'INVOICE' THEN
    INSERT INTO public.finance_journal_lines (
      organisation_id, journal_entry_id, account_id, position,
      debit_minor, credit_minor, description
    ) VALUES
      (v_org, v_journal_id, v_ar, 1, document_record.total_minor, 0, v_number),
      (v_org, v_journal_id, v_revenue, 2, 0, document_record.subtotal_minor, v_number);
    IF document_record.tax_minor > 0 THEN
      INSERT INTO public.finance_journal_lines (
        organisation_id, journal_entry_id, account_id, position,
        debit_minor, credit_minor, description
      ) VALUES (v_org, v_journal_id, v_vat, 3, 0, document_record.tax_minor, v_number);
    END IF;
  ELSE
    INSERT INTO public.finance_journal_lines (
      organisation_id, journal_entry_id, account_id, position,
      debit_minor, credit_minor, description
    ) VALUES
      (v_org, v_journal_id, v_revenue, 1, document_record.subtotal_minor, 0, v_number),
      (v_org, v_journal_id, v_ar, 3, 0, document_record.total_minor, v_number);
    IF document_record.tax_minor > 0 THEN
      INSERT INTO public.finance_journal_lines (
        organisation_id, journal_entry_id, account_id, position,
        debit_minor, credit_minor, description
      ) VALUES (v_org, v_journal_id, v_vat, 2, document_record.tax_minor, 0, v_number);
    END IF;
  END IF;

  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_user_profile_id, source, action,
    resource_type, resource_id, outcome, metadata
  ) VALUES (
    pg_catalog.gen_random_uuid(), v_org, 'USER', v_user, 'businessos-api',
    CASE document_record.document_type
      WHEN 'INVOICE' THEN 'finance.invoice.issued'
      ELSE 'finance.credit-note.issued'
    END,
    'finance_document', p_document_id::text, 'SUCCESS',
    jsonb_build_object('documentNumber', v_number, 'totalMinor', document_record.total_minor)
  );

  RETURN private.finance_document_payload(p_document_id);
END
$function$;

CREATE OR REPLACE FUNCTION private.void_finance_document(
  p_document_id uuid,
  p_expected_version integer,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id();
  v_user uuid := private.current_user_id();
  document_record record;
  original_record record;
  journal_record record;
  line_record record;
  v_sequence bigint;
  v_reversal_id uuid := pg_catalog.gen_random_uuid();
BEGIN
  IF v_org IS NULL OR v_user IS NULL
     OR NOT private.has_organisation_permission(v_org, 'invoices.void') THEN
    RAISE EXCEPTION 'finance void permission is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_reason IS NULL OR char_length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'a void reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO document_record FROM public.finance_documents
  WHERE id = p_document_id AND organisation_id = v_org FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'finance document was not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF document_record.version <> p_expected_version
     OR document_record.status NOT IN ('DRAFT', 'ISSUED', 'OVERDUE', 'PAID')
     OR (document_record.status = 'PAID'
       AND document_record.document_type <> 'CREDIT_NOTE')
     OR document_record.allocated_minor <> 0
     OR (document_record.document_type = 'INVOICE' AND document_record.credited_minor <> 0) THEN
    RAISE EXCEPTION 'finance document cannot be voided in its current state'
      USING ERRCODE = '55000';
  END IF;

  IF document_record.document_type = 'CREDIT_NOTE'
     AND document_record.status = 'PAID' THEN
    SELECT * INTO original_record FROM public.finance_documents
    WHERE id = document_record.related_document_id AND organisation_id = v_org
    FOR UPDATE;
    UPDATE public.finance_documents
    SET credited_minor = credited_minor - document_record.total_minor,
        balance_minor = balance_minor + document_record.total_minor,
        status = CASE
          WHEN allocated_minor = 0 AND credited_minor - document_record.total_minor = 0
            THEN 'ISSUED'
          ELSE 'PARTIALLY_PAID'
        END,
        version = version + 1,
        updated_by_user_id = v_user,
        updated_at = pg_catalog.now()
    WHERE id = original_record.id AND organisation_id = v_org;
  END IF;

  IF document_record.status IN ('ISSUED', 'OVERDUE', 'PAID') THEN
    SELECT * INTO journal_record FROM public.finance_journal_entries
    WHERE organisation_id = v_org
      AND source IN ('INVOICE', 'CREDIT_NOTE')
      AND source_id = p_document_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'posted document journal is unavailable' USING ERRCODE = '55000';
    END IF;

    INSERT INTO public.organisation_number_sequences (
      organisation_id, key, next_value
    ) VALUES (v_org, 'FINANCE_JOURNAL', 2)
    ON CONFLICT (organisation_id, key) DO UPDATE SET
      next_value = public.organisation_number_sequences.next_value + 1,
      updated_at = pg_catalog.now()
    RETURNING next_value - 1 INTO v_sequence;

    INSERT INTO public.finance_journal_entries (
      id, organisation_id, entry_number, source, source_id, entry_date,
      description, reversal_of_id, posted_by_user_id
    ) VALUES (
      v_reversal_id, v_org,
      'JRN-' || pg_catalog.lpad(v_sequence::text, 8, '0'),
      'REVERSAL', p_document_id, CURRENT_DATE,
      'Void ' || document_record.document_number,
      journal_record.id, v_user
    );

    FOR line_record IN
      SELECT * FROM public.finance_journal_lines
      WHERE journal_entry_id = journal_record.id AND organisation_id = v_org
      ORDER BY position
    LOOP
      INSERT INTO public.finance_journal_lines (
        organisation_id, journal_entry_id, account_id, position,
        debit_minor, credit_minor, description
      ) VALUES (
        v_org, v_reversal_id, line_record.account_id, line_record.position,
        line_record.credit_minor, line_record.debit_minor,
        'Reversal: ' || document_record.document_number
      );
    END LOOP;
  END IF;

  UPDATE public.finance_documents
  SET status = 'VOID', balance_minor = 0,
      voided_at = pg_catalog.now(), voided_by_user_id = v_user,
      void_reason = btrim(p_reason), updated_by_user_id = v_user,
      version = version + 1, updated_at = pg_catalog.now()
  WHERE id = p_document_id AND organisation_id = v_org;

  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_user_profile_id, source, action,
    resource_type, resource_id, outcome, reason
  ) VALUES (
    pg_catalog.gen_random_uuid(), v_org, 'USER', v_user, 'businessos-api',
    'finance.document.voided',
    'finance_document', p_document_id::text, 'SUCCESS', btrim(p_reason)
  );

  RETURN private.finance_document_payload(p_document_id);
END
$function$;

CREATE OR REPLACE FUNCTION private.record_finance_payment(p_input jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id();
  v_user uuid := private.current_user_id();
  v_payment_id uuid := pg_catalog.gen_random_uuid();
  v_client uuid;
  v_type public.finance_payment_type;
  v_method public.finance_payment_method;
  v_currency char(3);
  v_amount bigint;
  v_occurred timestamptz;
  v_related uuid;
  v_idempotency text;
  v_sequence bigint;
  v_journal_sequence bigint;
  v_payment_number text;
  v_journal_id uuid := pg_catalog.gen_random_uuid();
  v_bank uuid;
  v_ar uuid;
  v_allocation jsonb;
  v_document record;
  v_original_allocation bigint;
  v_refunded_allocation bigint;
  v_total bigint := 0;
  v_seen uuid[] := ARRAY[]::uuid[];
  existing_payment uuid;
BEGIN
  IF v_org IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'finance context is required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_client := (p_input ->> 'clientId')::uuid;
  v_type := (p_input ->> 'paymentType')::public.finance_payment_type;
  v_method := (p_input ->> 'method')::public.finance_payment_method;
  v_currency := (p_input ->> 'currencyCode')::char(3);
  v_amount := (p_input ->> 'amountMinor')::bigint;
  v_occurred := (p_input ->> 'occurredAt')::timestamptz;
  v_related := NULLIF(p_input ->> 'relatedPaymentId', '')::uuid;
  v_idempotency := p_input ->> 'idempotencyKey';

  IF NOT private.has_organisation_permission(v_org, 'payments.record')
     OR (v_type = 'REFUND'
       AND NOT private.has_organisation_permission(v_org, 'payments.refund')) THEN
    RAISE EXCEPTION 'finance payment permission is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_amount <= 0 OR jsonb_typeof(p_input -> 'allocations') <> 'array'
     OR jsonb_array_length(p_input -> 'allocations') = 0 THEN
    RAISE EXCEPTION 'payment amount and allocations are required' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO existing_payment FROM public.finance_payments
  WHERE organisation_id = v_org AND idempotency_key = v_idempotency;
  IF FOUND THEN
    RETURN private.finance_payment_payload(existing_payment);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.clients
    WHERE id = v_client AND organisation_id = v_org
      AND status IN ('ONBOARDING', 'ACTIVE') AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'payment client is unavailable' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_type = 'RECEIPT' AND v_related IS NOT NULL THEN
    RAISE EXCEPTION 'a receipt cannot reference another payment' USING ERRCODE = '22023';
  END IF;
  IF v_type = 'REFUND' THEN
    IF v_related IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.finance_payments
      WHERE id = v_related AND organisation_id = v_org
        AND client_id = v_client AND payment_type = 'RECEIPT'
        AND status = 'CLEARED' AND currency_code = v_currency
    ) THEN
      RAISE EXCEPTION 'original receipt is unavailable' USING ERRCODE = '22023';
    END IF;
    IF (
      SELECT COALESCE(sum(refund.amount_minor), 0) + v_amount
      FROM public.finance_payments AS refund
      WHERE refund.organisation_id = v_org
        AND refund.related_payment_id = v_related
        AND refund.payment_type = 'REFUND' AND refund.status = 'CLEARED'
    ) > (
      SELECT amount_minor FROM public.finance_payments
      WHERE id = v_related AND organisation_id = v_org
    ) THEN
      RAISE EXCEPTION 'refund exceeds the original receipt' USING ERRCODE = '22003';
    END IF;
  END IF;

  FOR v_allocation IN SELECT value FROM jsonb_array_elements(p_input -> 'allocations')
  LOOP
    IF (v_allocation ->> 'documentId')::uuid = ANY(v_seen) THEN
      RAISE EXCEPTION 'duplicate payment allocation' USING ERRCODE = '22023';
    END IF;
    v_seen := array_append(v_seen, (v_allocation ->> 'documentId')::uuid);
    v_total := v_total + (v_allocation ->> 'amountMinor')::bigint;
  END LOOP;
  IF v_total <> v_amount THEN
    RAISE EXCEPTION 'payment allocations do not equal payment amount'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.organisation_number_sequences (
    organisation_id, key, next_value
  ) VALUES (v_org, 'FINANCE_PAYMENT', 2)
  ON CONFLICT (organisation_id, key) DO UPDATE SET
    next_value = public.organisation_number_sequences.next_value + 1,
    updated_at = pg_catalog.now()
  RETURNING next_value - 1 INTO v_sequence;
  v_payment_number := (
    SELECT payment_prefix FROM public.finance_settings WHERE organisation_id = v_org
  ) || '-' || pg_catalog.lpad(v_sequence::text, 8, '0');

  INSERT INTO public.finance_payments (
    id, organisation_id, client_id, payment_number, payment_type,
    method, currency_code, amount_minor, occurred_at, reference,
    provider, provider_reference, related_payment_id, idempotency_key,
    recorded_by_user_id
  ) VALUES (
    v_payment_id, v_org, v_client, v_payment_number, v_type, v_method,
    v_currency, v_amount, v_occurred, NULLIF(p_input ->> 'reference', ''),
    NULLIF(p_input ->> 'provider', ''),
    NULLIF(p_input ->> 'providerReference', ''), v_related,
    v_idempotency, v_user
  );

  FOR v_allocation IN SELECT value FROM jsonb_array_elements(p_input -> 'allocations')
  LOOP
    SELECT * INTO v_document FROM public.finance_documents
    WHERE id = (v_allocation ->> 'documentId')::uuid
      AND organisation_id = v_org AND client_id = v_client
      AND document_type = 'INVOICE'
      AND status IN ('ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE')
      AND currency_code = v_currency
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invoice allocation target is unavailable' USING ERRCODE = 'no_data_found';
    END IF;

    IF v_type = 'RECEIPT' THEN
      IF v_document.balance_minor < (v_allocation ->> 'amountMinor')::bigint THEN
        RAISE EXCEPTION 'payment allocation exceeds invoice balance' USING ERRCODE = '22003';
      END IF;
      UPDATE public.finance_documents
      SET allocated_minor = allocated_minor + (v_allocation ->> 'amountMinor')::bigint,
          balance_minor = balance_minor - (v_allocation ->> 'amountMinor')::bigint,
          status = CASE
            WHEN balance_minor - (v_allocation ->> 'amountMinor')::bigint = 0
              THEN 'PAID'
            ELSE 'PARTIALLY_PAID'
          END,
          updated_by_user_id = v_user, version = version + 1,
          updated_at = pg_catalog.now()
      WHERE id = v_document.id AND organisation_id = v_org;
    ELSE
      SELECT allocation.amount_minor INTO v_original_allocation
      FROM public.finance_payment_allocations AS allocation
      WHERE allocation.payment_id = v_related
        AND allocation.document_id = v_document.id
        AND allocation.organisation_id = v_org;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'refund invoice was not allocated by the original receipt'
          USING ERRCODE = '22023';
      END IF;
      SELECT COALESCE(sum(allocation.amount_minor), 0)
      INTO v_refunded_allocation
      FROM public.finance_payments AS refund
      JOIN public.finance_payment_allocations AS allocation
        ON allocation.payment_id = refund.id
       AND allocation.organisation_id = refund.organisation_id
      WHERE refund.organisation_id = v_org
        AND refund.related_payment_id = v_related
        AND refund.payment_type = 'REFUND'
        AND refund.status = 'CLEARED'
        AND allocation.document_id = v_document.id;
      IF v_refunded_allocation + (v_allocation ->> 'amountMinor')::bigint
          > v_original_allocation THEN
        RAISE EXCEPTION 'refund allocation exceeds the original allocation'
          USING ERRCODE = '22003';
      END IF;
      UPDATE public.finance_documents
      SET allocated_minor = allocated_minor - (v_allocation ->> 'amountMinor')::bigint,
          balance_minor = balance_minor + (v_allocation ->> 'amountMinor')::bigint,
          status = CASE
            WHEN allocated_minor - (v_allocation ->> 'amountMinor')::bigint = 0
              AND credited_minor = 0 THEN 'ISSUED'
            ELSE 'PARTIALLY_PAID'
          END,
          updated_by_user_id = v_user, version = version + 1,
          updated_at = pg_catalog.now()
      WHERE id = v_document.id AND organisation_id = v_org;
    END IF;

    INSERT INTO public.finance_payment_allocations (
      organisation_id, payment_id, document_id, amount_minor
    ) VALUES (
      v_org, v_payment_id, v_document.id,
      (v_allocation ->> 'amountMinor')::bigint
    );
  END LOOP;

  SELECT
    (max(id::text) FILTER (WHERE system_key = 'BANK'))::uuid,
    (max(id::text) FILTER (WHERE system_key = 'ACCOUNTS_RECEIVABLE'))::uuid
  INTO v_bank, v_ar
  FROM public.finance_ledger_accounts
  WHERE organisation_id = v_org AND active;
  IF v_bank IS NULL OR v_ar IS NULL THEN
    RAISE EXCEPTION 'finance ledger defaults are unavailable' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.organisation_number_sequences (
    organisation_id, key, next_value
  ) VALUES (v_org, 'FINANCE_JOURNAL', 2)
  ON CONFLICT (organisation_id, key) DO UPDATE SET
    next_value = public.organisation_number_sequences.next_value + 1,
    updated_at = pg_catalog.now()
  RETURNING next_value - 1 INTO v_journal_sequence;

  INSERT INTO public.finance_journal_entries (
    id, organisation_id, entry_number, source, source_id,
    entry_date, description, posted_by_user_id
  ) VALUES (
    v_journal_id, v_org,
    'JRN-' || pg_catalog.lpad(v_journal_sequence::text, 8, '0'),
    (CASE v_type WHEN 'RECEIPT' THEN 'PAYMENT' ELSE 'REFUND' END)
      ::public.finance_journal_source,
    v_payment_id, v_occurred::date,
    CASE v_type WHEN 'RECEIPT' THEN 'Receipt ' ELSE 'Refund ' END
      || v_payment_number,
    v_user
  );

  INSERT INTO public.finance_journal_lines (
    organisation_id, journal_entry_id, account_id, position,
    debit_minor, credit_minor, description
  ) VALUES
    (v_org, v_journal_id,
      CASE v_type WHEN 'RECEIPT' THEN v_bank ELSE v_ar END,
      1, v_amount, 0, v_payment_number),
    (v_org, v_journal_id,
      CASE v_type WHEN 'RECEIPT' THEN v_ar ELSE v_bank END,
      2, 0, v_amount, v_payment_number);

  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_user_profile_id, source, action,
    resource_type, resource_id, outcome, metadata
  ) VALUES (
    pg_catalog.gen_random_uuid(), v_org, 'USER', v_user, 'businessos-api',
    CASE v_type WHEN 'RECEIPT' THEN 'finance.payment.recorded'
      ELSE 'finance.refund.recorded' END,
    'finance_payment', v_payment_id::text, 'SUCCESS',
    jsonb_build_object('paymentNumber', v_payment_number, 'amountMinor', v_amount)
  );

  RETURN private.finance_payment_payload(v_payment_id);
END
$function$;

CREATE OR REPLACE FUNCTION private.get_finance_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id();
BEGIN
  IF v_org IS NULL OR private.current_user_id() IS NULL
     OR NOT private.has_organisation_permission(v_org, 'finance.read') THEN
    RAISE EXCEPTION 'finance read permission is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN jsonb_build_object(
    'settings', (
      SELECT jsonb_build_object(
        'id', settings.id,
        'organisationId', settings.organisation_id,
        'legalName', settings.legal_name,
        'addressLine1', settings.address_line_1,
        'addressLine2', settings.address_line_2,
        'city', settings.city,
        'region', settings.region,
        'postalCode', settings.postal_code,
        'countryCode', settings.country_code,
        'vatScheme', settings.vat_scheme,
        'vatRegistrationNumber', settings.vat_registration_number,
        'baseCurrency', settings.base_currency,
        'invoicePrefix', settings.invoice_prefix,
        'creditNotePrefix', settings.credit_note_prefix,
        'paymentPrefix', settings.payment_prefix,
        'paymentTermsDays', settings.payment_terms_days,
        'paymentInstructions', settings.payment_instructions,
        'version', settings.version,
        'updatedAt', settings.updated_at
      ) FROM public.finance_settings AS settings
      WHERE settings.organisation_id = v_org
    ),
    'summary', jsonb_build_object(
      'draftCount', (SELECT count(*) FROM public.finance_documents
        WHERE organisation_id = v_org AND status = 'DRAFT'),
      'openCount', (SELECT count(*) FROM public.finance_documents
        WHERE organisation_id = v_org AND document_type = 'INVOICE'
          AND status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')
          AND balance_minor > 0),
      'overdueCount', (SELECT count(*) FROM public.finance_documents
        WHERE organisation_id = v_org AND document_type = 'INVOICE'
          AND status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')
          AND balance_minor > 0 AND due_date < CURRENT_DATE),
      'receivableMinor', COALESCE((SELECT sum(balance_minor)::text
        FROM public.finance_documents WHERE organisation_id = v_org
          AND document_type = 'INVOICE' AND status <> 'VOID'), '0'),
      'received30DaysMinor', COALESCE((SELECT sum(amount_minor)::text
        FROM public.finance_payments WHERE organisation_id = v_org
          AND payment_type = 'RECEIPT' AND status = 'CLEARED'
          AND occurred_at >= pg_catalog.now() - interval '30 days'), '0')
    ),
    'clients', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', client.id, 'clientNumber', client.client_number,
      'displayName', client.display_name, 'email', client.email
    ) ORDER BY client.display_name)
    FROM public.clients AS client
    WHERE client.organisation_id = v_org
      AND client.status IN ('ONBOARDING', 'ACTIVE') AND client.deleted_at IS NULL), '[]'::jsonb),
    'matters', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', matter.id, 'matterNumber', matter.matter_number,
      'title', matter.title, 'clientId', party.client_id
    ) ORDER BY matter.opened_at DESC)
    FROM public.matters AS matter
    JOIN public.matter_parties AS party
      ON party.organisation_id = matter.organisation_id
     AND party.matter_id = matter.id AND party.role = 'PRIMARY_CLIENT'
     AND party.deleted_at IS NULL
    WHERE matter.organisation_id = v_org AND matter.deleted_at IS NULL
      AND matter.status NOT IN ('ARCHIVED', 'CANCELLED')), '[]'::jsonb),
    'documents', COALESCE((SELECT jsonb_agg(
      private.finance_document_payload(document.id)
      ORDER BY document.created_at DESC
    ) FROM (SELECT id, created_at FROM public.finance_documents
      WHERE organisation_id = v_org ORDER BY created_at DESC LIMIT 200) AS document), '[]'::jsonb),
    'payments', COALESCE((SELECT jsonb_agg(
      private.finance_payment_payload(payment.id)
      ORDER BY payment.occurred_at DESC
    ) FROM (SELECT id, occurred_at FROM public.finance_payments
      WHERE organisation_id = v_org ORDER BY occurred_at DESC LIMIT 200) AS payment), '[]'::jsonb),
    'journal', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', entry.id, 'entryNumber', entry.entry_number,
      'source', entry.source, 'sourceId', entry.source_id,
      'entryDate', entry.entry_date, 'description', entry.description,
      'postedAt', entry.posted_at,
      'debitMinor', (SELECT sum(line.debit_minor)::text
        FROM public.finance_journal_lines AS line
        WHERE line.journal_entry_id = entry.id AND line.organisation_id = v_org),
      'creditMinor', (SELECT sum(line.credit_minor)::text
        FROM public.finance_journal_lines AS line
        WHERE line.journal_entry_id = entry.id AND line.organisation_id = v_org)
    ) ORDER BY entry.posted_at DESC)
    FROM (SELECT * FROM public.finance_journal_entries
      WHERE organisation_id = v_org ORDER BY posted_at DESC LIMIT 200) AS entry), '[]'::jsonb)
  );
END
$function$;

CREATE OR REPLACE FUNCTION private.get_client_portal_finance_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user uuid := private.current_user_id();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authentication context is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(invoice_payload ORDER BY issue_date DESC, created_at DESC)
    FROM (
      SELECT DISTINCT
        document.issue_date,
        document.created_at,
        jsonb_build_object(
          'id', document.id,
          'organisationId', document.organisation_id,
          'matterId', document.matter_id,
          'matterNumber', matter.matter_number,
          'documentType', document.document_type,
          'documentNumber', document.document_number,
          'status', CASE
            WHEN document.status IN ('ISSUED', 'PARTIALLY_PAID')
              AND document.balance_minor > 0 AND document.due_date < CURRENT_DATE
              THEN 'OVERDUE'
            ELSE document.status::text
          END,
          'currencyCode', document.currency_code,
          'issueDate', document.issue_date,
          'dueDate', document.due_date,
          'reference', document.reference,
          'subtotalMinor', document.subtotal_minor::text,
          'taxMinor', document.tax_minor::text,
          'totalMinor', document.total_minor::text,
          'balanceMinor', document.balance_minor::text,
          'sellerName', document.seller_snapshot ->> 'legalName',
          'paymentInstructions', document.seller_snapshot ->> 'paymentInstructions'
        ) AS invoice_payload
      FROM public.client_portal_access_grants AS access
      JOIN public.client_portal_matter_grants AS matter_grant
        ON matter_grant.access_grant_id = access.id
       AND matter_grant.organisation_id = access.organisation_id
      JOIN public.matters AS matter
        ON matter.id = matter_grant.matter_id
       AND matter.organisation_id = matter_grant.organisation_id
       AND matter.deleted_at IS NULL
      JOIN public.finance_documents AS document
        ON document.organisation_id = matter.organisation_id
       AND document.matter_id = matter.id
       AND document.client_id = access.client_id
       AND document.client_visible
       AND document.status IN ('ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE')
      WHERE access.user_profile_id = v_user
        AND access.status = 'ACTIVE'
        AND access.starts_at <= pg_catalog.now()
        AND (access.expires_at IS NULL OR access.expires_at > pg_catalog.now())
        AND 'BILLING' = ANY(access.scopes)
    ) AS portal_invoices
  ), '[]'::jsonb);
END
$function$;

CREATE OR REPLACE FUNCTION private.reject_finance_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  RAISE EXCEPTION 'posted finance evidence is append-only'
    USING ERRCODE = 'object_not_in_prerequisite_state';
END
$function$;

REVOKE ALL ON FUNCTION private.finance_document_payload(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.finance_payment_payload(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.issue_finance_document(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.void_finance_document(uuid, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.record_finance_payment(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.get_finance_dashboard() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.get_client_portal_finance_dashboard() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.reject_finance_evidence_mutation() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION private.finance_document_payload(uuid) TO businessos_app;
GRANT EXECUTE ON FUNCTION private.finance_payment_payload(uuid) TO businessos_app;
GRANT EXECUTE ON FUNCTION private.issue_finance_document(uuid, integer) TO businessos_app;
GRANT EXECUTE ON FUNCTION private.void_finance_document(uuid, integer, text) TO businessos_app;
GRANT EXECUTE ON FUNCTION private.record_finance_payment(jsonb) TO businessos_app;
GRANT EXECUTE ON FUNCTION private.get_finance_dashboard() TO businessos_app;
GRANT EXECUTE ON FUNCTION private.get_client_portal_finance_dashboard() TO businessos_app;

REVOKE ALL ON TABLE public.finance_settings,
  public.finance_ledger_accounts, public.finance_documents,
  public.finance_document_lines, public.finance_payments,
  public.finance_payment_allocations, public.finance_journal_entries,
  public.finance_journal_lines
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.finance_settings,
  public.finance_ledger_accounts, public.finance_documents,
  public.finance_document_lines, public.finance_payments,
  public.finance_payment_allocations, public.finance_journal_entries,
  public.finance_journal_lines TO businessos_app;
GRANT UPDATE ON TABLE public.finance_settings TO businessos_app;
GRANT INSERT ON TABLE public.finance_documents,
  public.finance_document_lines TO businessos_app;

ALTER TABLE public.finance_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.finance_ledger_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_ledger_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.finance_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.finance_document_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_document_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE public.finance_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_payments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.finance_payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_payment_allocations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.finance_journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_journal_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE public.finance_journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_journal_lines FORCE ROW LEVEL SECURITY;

CREATE POLICY finance_settings_select ON public.finance_settings
  FOR SELECT TO businessos_app
  USING (private.has_organisation_permission(organisation_id, 'finance.read'));
CREATE POLICY finance_settings_update ON public.finance_settings
  FOR UPDATE TO businessos_app
  USING (private.has_organisation_permission(organisation_id, 'finance.settings.manage'))
  WITH CHECK (
    private.has_organisation_permission(organisation_id, 'finance.settings.manage')
    AND updated_by_user_id = private.current_user_id()
  );
CREATE POLICY finance_accounts_select ON public.finance_ledger_accounts
  FOR SELECT TO businessos_app
  USING (
    private.has_organisation_permission(organisation_id, 'finance.read')
    OR private.has_organisation_permission(organisation_id, 'ledger.read')
  );
CREATE POLICY finance_documents_select ON public.finance_documents
  FOR SELECT TO businessos_app
  USING (private.has_organisation_permission(organisation_id, 'finance.read'));
CREATE POLICY finance_documents_insert ON public.finance_documents
  FOR INSERT TO businessos_app
  WITH CHECK (
    private.has_organisation_permission(organisation_id, 'invoices.create')
    AND created_by_user_id = private.current_user_id()
    AND updated_by_user_id = private.current_user_id()
  );
CREATE POLICY finance_lines_select ON public.finance_document_lines
  FOR SELECT TO businessos_app
  USING (private.has_organisation_permission(organisation_id, 'finance.read'));
CREATE POLICY finance_lines_insert ON public.finance_document_lines
  FOR INSERT TO businessos_app
  WITH CHECK (
    private.has_organisation_permission(organisation_id, 'invoices.create')
    AND EXISTS (
      SELECT 1 FROM public.finance_documents AS document
      WHERE document.id = finance_document_lines.document_id
        AND document.organisation_id = finance_document_lines.organisation_id
        AND document.status = 'DRAFT'
        AND document.created_by_user_id = private.current_user_id()
    )
  );
CREATE POLICY finance_payments_select ON public.finance_payments
  FOR SELECT TO businessos_app
  USING (private.has_organisation_permission(organisation_id, 'finance.read'));
CREATE POLICY finance_allocations_select ON public.finance_payment_allocations
  FOR SELECT TO businessos_app
  USING (private.has_organisation_permission(organisation_id, 'finance.read'));
CREATE POLICY finance_journals_select ON public.finance_journal_entries
  FOR SELECT TO businessos_app
  USING (private.has_organisation_permission(organisation_id, 'ledger.read'));
CREATE POLICY finance_journal_lines_select ON public.finance_journal_lines
  FOR SELECT TO businessos_app
  USING (private.has_organisation_permission(organisation_id, 'ledger.read'));

CREATE TRIGGER finance_settings_immutable_identity
  BEFORE UPDATE ON public.finance_settings
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'created_at'
  );
CREATE TRIGGER finance_accounts_append_only
  BEFORE UPDATE OR DELETE ON public.finance_ledger_accounts
  FOR EACH ROW EXECUTE FUNCTION private.reject_finance_evidence_mutation();
CREATE TRIGGER finance_documents_immutable_evidence
  BEFORE UPDATE ON public.finance_documents
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'client_id', 'matter_id', 'document_type',
    'related_document_id', 'currency_code', 'subtotal_minor', 'tax_minor',
    'total_minor', 'client_visible', 'created_by_user_id', 'created_at'
  );
CREATE TRIGGER finance_document_lines_append_only
  BEFORE UPDATE OR DELETE ON public.finance_document_lines
  FOR EACH ROW EXECUTE FUNCTION private.reject_finance_evidence_mutation();
CREATE TRIGGER finance_payments_append_only
  BEFORE UPDATE OR DELETE ON public.finance_payments
  FOR EACH ROW EXECUTE FUNCTION private.reject_finance_evidence_mutation();
CREATE TRIGGER finance_allocations_append_only
  BEFORE UPDATE OR DELETE ON public.finance_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION private.reject_finance_evidence_mutation();
CREATE TRIGGER finance_journals_append_only
  BEFORE UPDATE OR DELETE ON public.finance_journal_entries
  FOR EACH ROW EXECUTE FUNCTION private.reject_finance_evidence_mutation();
CREATE TRIGGER finance_journal_lines_append_only
  BEFORE UPDATE OR DELETE ON public.finance_journal_lines
  FOR EACH ROW EXECUTE FUNCTION private.reject_finance_evidence_mutation();

COMMENT ON TABLE public.finance_documents IS
  'Tenant-isolated UK invoice and credit-note evidence using integer minor units.';
COMMENT ON TABLE public.finance_journal_entries IS
  'Append-only double-entry accounting evidence generated by controlled finance actions.';
COMMENT ON FUNCTION private.record_finance_payment(jsonb) IS
  'Atomically records a receipt or controlled refund, allocations and balanced journal evidence.';

COMMIT;
