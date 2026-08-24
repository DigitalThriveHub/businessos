-- Gate H: permit verified external inbound messages to enter the controlled
-- human matching queue without weakening portal or staff-created links.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '180s';

ALTER TABLE public.communication_conversations
  DROP CONSTRAINT ck_conversation_link;

ALTER TABLE public.communication_conversations
  ADD CONSTRAINT ck_conversation_link CHECK (
    matter_id IS NOT NULL
    OR client_id IS NOT NULL
    OR (
      channel IN ('EMAIL', 'WHATSAPP')
      AND created_by_user_id IS NULL
    )
  );

COMMENT ON CONSTRAINT ck_conversation_link
  ON public.communication_conversations IS
  'Conversations require a tenant link except verified external email or WhatsApp awaiting an audited human matching decision.';

COMMIT;
