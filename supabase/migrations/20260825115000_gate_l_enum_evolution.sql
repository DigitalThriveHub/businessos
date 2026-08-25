-- Gate L enum evolution is isolated so PostgreSQL commits new enum values
-- before the following schema migration uses them in tables and functions.

ALTER TYPE public.integration_provider ADD VALUE IF NOT EXISTS 'MICROSOFT_365';
ALTER TYPE public.integration_provider ADD VALUE IF NOT EXISTS 'GOOGLE_WORKSPACE';
ALTER TYPE public.integration_provider ADD VALUE IF NOT EXISTS 'WHATSAPP_BUSINESS';

ALTER TYPE public.agent_action_status ADD VALUE IF NOT EXISTS 'APPROVED';
ALTER TYPE public.agent_action_status ADD VALUE IF NOT EXISTS 'EXECUTING';
ALTER TYPE public.agent_action_status ADD VALUE IF NOT EXISTS 'EXECUTED';
ALTER TYPE public.agent_action_status ADD VALUE IF NOT EXISTS 'FAILED';
