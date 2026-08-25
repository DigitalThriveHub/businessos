import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function migration(name: string): string {
  return readFileSync(
    resolve(process.cwd(), '../../supabase/migrations', name),
    'utf8',
  );
}

describe('Gate L migration contract', () => {
  const enums = migration('20260825115000_gate_l_enum_evolution.sql');
  const schema = migration(
    '20260825120000_gate_l_live_communications_calendar.sql',
  );
  const runtimeCasts = migration(
    '20260825133000_gate_l_runtime_enum_casts.sql',
  );

  it('commits enum evolution separately before using the new values', () => {
    expect(enums).toContain("ADD VALUE IF NOT EXISTS 'MICROSOFT_365'");
    expect(enums).toContain("ADD VALUE IF NOT EXISTS 'EXECUTED'");
    expect(schema).not.toMatch(/ALTER\s+TYPE[\s\S]+ADD\s+VALUE/i);
    expect(schema.indexOf('BEGIN;')).toBeLessThan(
      schema.indexOf('CREATE TYPE public.provider_connection_state'),
    );
  });

  it('expands the guarded AI action transition before draft materialisation', () => {
    expect(schema).toContain('DROP CONSTRAINT ck_agent_actions_status');
    expect(schema).toContain(
      "OLD.status = 'PENDING_APPROVAL'\n         AND NEW.status IN ('APPROVED','EXECUTED','FAILED','BLOCKED')",
    );
    expect(schema.indexOf('validate_agent_action_update')).toBeLessThan(
      schema.indexOf('materialise_approved_ai_draft'),
    );
  });

  it('forces tenant RLS and stores references rather than provider credentials', () => {
    for (const table of [
      'provider_connection_configs',
      'business_calendar_events',
      'provider_webhook_receipts',
    ]) {
      expect(schema).toContain(
        `ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY`,
      );
    }
    expect(schema).toContain('secret_reference varchar(160) NOT NULL');
    expect(schema).toContain('private.set_provider_connection_status');
    expect(schema).toContain('private.begin_calendar_retry');
    expect(schema).not.toMatch(
      /\b(access_token|refresh_token|client_secret)\b/i,
    );
  });

  it('keeps every security-definer function body structurally closed', () => {
    expect(schema.match(/^CREATE OR REPLACE FUNCTION/gm)?.length).toBe(
      schema.match(/^\$function\$;/gm)?.length,
    );
    expect(schema).not.toMatch(/^END\r?\n\$function\$;/gm);
    expect(schema.match(/^END;\r?\n\$function\$;/gm)?.length).toBe(20);
    expect(schema).toContain(
      "(CASE WHEN v_conversation.channel = 'WHATSAPP' THEN 1 ELSE 20 END) THEN",
    );
    expect(schema.trimEnd().endsWith('COMMIT;')).toBe(true);
  });

  it('restores enum-safe runtime writes after Gate L function replacement', () => {
    expect(runtimeCasts).toContain('::public.communication_message_status');
    expect(runtimeCasts).toContain(
      '::public.communication_delivery_event_type',
    );
    expect(runtimeCasts).toContain('::public.communication_reminder_status');
    expect(runtimeCasts).toContain(
      'private.create_staff_communication_message',
    );
    expect(runtimeCasts).toContain(
      'private.materialise_due_communication_reminders',
    );
    expect(runtimeCasts.trimEnd().endsWith('COMMIT;')).toBe(true);
  });
});
