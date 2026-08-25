import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260825180000_gate_n_uk_compliance_production_assurance.sql',
  ),
  'utf8',
);

describe('Gate N migration contract', () => {
  it('keeps every function structurally closed inside one transaction', () => {
    expect(migration.match(/^CREATE OR REPLACE FUNCTION/gm)?.length).toBe(22);
    expect(migration.match(/^\$function\$;/gm)?.length).toBe(22);
    // Nineteen PL/pgSQL bodies close with END; and three SQL bodies do not.
    expect(migration.match(/^END;\r?\n\$function\$;/gm)?.length).toBe(19);
    expect(migration).not.toMatch(/^END\r?\n\$function\$;/gm);
    expect(migration.trimStart().indexOf('BEGIN;')).toBeGreaterThanOrEqual(0);
    expect(migration.trimEnd().endsWith('COMMIT;')).toBe(true);
  });

  it('forces tenant RLS and withholds direct evidence-table writes', () => {
    for (const table of [
      'data_subject_requests',
      'data_subject_request_events',
      'legal_holds',
      'retention_policies',
      'retention_reviews',
      'privacy_incidents',
      'privacy_incident_events',
      'assurance_evidence',
      'production_release_decisions',
    ]) {
      expect(migration).toContain(
        `ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY`,
      );
    }
    expect(migration).not.toMatch(
      /GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)[\s\S]{0,200}TO\s+businessos_app/i,
    );
  });

  it('encodes controlled UK rights and breach clocks without legal overclaim', () => {
    expect(migration).toContain("+ interval '1 month'");
    expect(migration).toContain("+ interval '2 months'");
    expect(migration).toContain("+ interval '72 hours'");
    expect(migration).toContain('private.extend_data_subject_request');
    expect(migration).toContain('notificationReferenceRecorded');
    expect(migration).toContain('humanDisclosureReviewRequired');
    expect(migration).toContain('automaticallyDelivered');
    expect(migration).toContain('notification_decision');
  });

  it('blocks disposition under legal hold and never executes deletion', () => {
    expect(migration).toContain('private.find_active_legal_hold');
    expect(migration).toContain(
      "p_decision IN ('ARCHIVE', 'ANONYMISE', 'DELETE')",
    );
    expect(migration).toContain(
      "'destructiveActionExecutedByThisFunction', false",
    );
    expect(migration).toContain("'destructiveActionExecuted', false");
  });

  it('requires independent evidence review and a separate release approver', () => {
    expect(migration).toContain(
      'Evidence must be reviewed by a different AAL2 user',
    );
    expect(migration).toContain('SEGREGATION_OF_DUTIES');
    expect(migration).toContain(
      'The release decider cannot be the recorder or reviewer of this critical evidence.',
    );
    expect(migration).toContain('security.penetration_test');
    expect(migration).toContain('backup.restore');
    expect(migration).toContain('acceptance.uk_pilot');
    expect(migration).toContain(
      'Mandatory assurance evidence exceeds its maximum validity window',
    );
    expect(migration).toContain("interval '45 days'");
    expect(migration).toContain('immutableSnapshotRecorded');
  });

  it('keeps the certification boundary explicit', () => {
    expect(migration).toContain(
      'Independent certification, penetration testing and production-provider evidence must come from the responsible external parties.',
    );
    expect(migration).toContain('get_production_release_blockers');
    expect(migration).toContain(
      'Production release is blocked by unresolved controls',
    );
  });
});
