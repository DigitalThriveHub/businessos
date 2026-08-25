import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260825150000_gate_m_operational_intelligence.sql',
  ),
  'utf8',
);

describe('Gate M migration contract', () => {
  it('keeps every function body structurally closed in one transaction', () => {
    expect(migration.match(/^CREATE OR REPLACE FUNCTION/gm)?.length).toBe(11);
    expect(migration.match(/^\$function\$;/gm)?.length).toBe(11);
    expect(migration.match(/^END;\r?\n\$function\$;/gm)?.length).toBe(11);
    expect(migration).not.toMatch(/^END\r?\n\$function\$;/gm);
    expect(migration.trimStart().indexOf('BEGIN;')).toBeGreaterThanOrEqual(0);
    expect(migration.trimEnd().endsWith('COMMIT;')).toBe(true);
  });

  it('forces tenant RLS and withholds raw writes to evidence tables', () => {
    for (const table of [
      'document_intelligence_analyses',
      'document_intelligence_reviews',
      'document_intelligence_jobs',
      'organisation_value_benchmarks',
      'automation_value_events',
      'operational_metric_snapshots',
    ]) {
      expect(migration).toContain(
        `ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY`,
      );
    }
    expect(migration).toContain(
      'CREATE TRIGGER document_intelligence_reviews_immutable',
    );
    expect(migration).not.toMatch(
      /GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)[\s\S]{0,200}TO\s+businessos_app/i,
    );
  });

  it('allows only clean current document versions into the worker lease', () => {
    expect(migration).toContain("version_record.scan_status = 'CLEAN'");
    expect(migration).toContain(
      'document_record.current_version_id = version_record.id',
    );
    expect(migration).toContain('FOR UPDATE OF job SKIP LOCKED');
    expect(migration).toContain("last_error_code = 'LEASE_EXPIRED'");
    expect(migration).toContain("status = 'DEAD_LETTER'");
  });

  it('keeps provider results advisory until an AAL2 human decision', () => {
    expect(migration).toContain("private.current_aal() <> 'AAL2'");
    expect(migration).toContain("'providerOutputWasAdvisory', true");
    expect(migration).toContain("'humanConfirmationRequired', true");
    expect(migration).toContain('private.review_document_intelligence');
    expect(migration).toContain('p_expected_version integer');
  });

  it('records configurable estimates without presenting them as revenue', () => {
    expect(migration).toContain('organisation_value_benchmarks');
    expect(migration).toContain('automation_value_events');
    expect(migration).toContain(
      'Time and monetary values are estimates based on organisation-configured benchmark assumptions.',
    );
    expect(migration).toContain(
      "'estimateBasis', 'ORGANISATION_CONFIGURABLE_BENCHMARKS'",
    );
  });

  it('stores provider evidence but no provider credential fields', () => {
    expect(migration).toContain('provider_response_id varchar(240)');
    expect(migration).toContain('estimated_cost_minor bigint');
    expect(migration).not.toMatch(
      /\b(access_token|refresh_token|client_secret|api_key)\b/i,
    );
  });
});
