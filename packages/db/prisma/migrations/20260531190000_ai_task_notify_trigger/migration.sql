-- pg_notify('ai_task_new', task.id) whenever an ai_tasks row enters PENDING
-- (initial insert OR retry-reset from FAILED back to PENDING). The agent-
-- worker LISTENs on this channel so it wakes within milliseconds instead of
-- polling every 2s. Polling stays as a 30s safety net for when the LISTEN
-- connection drops.
--
-- NOTE: prod is shaped by `prisma db push`, which ignores migration files.
-- The worker re-runs the same SQL on startup (idempotent CREATE OR REPLACE)
-- so this file is mainly local-dev + audit-trail. See
-- apps/agent-worker/src/notify-bootstrap.ts.

CREATE OR REPLACE FUNCTION notify_ai_task_pending() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."status" = 'PENDING' THEN
    PERFORM pg_notify('ai_task_new', NEW."id");
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_task_notify_insert ON "ai_tasks";
CREATE TRIGGER ai_task_notify_insert
  AFTER INSERT ON "ai_tasks"
  FOR EACH ROW
  EXECUTE FUNCTION notify_ai_task_pending();

DROP TRIGGER IF EXISTS ai_task_notify_update ON "ai_tasks";
CREATE TRIGGER ai_task_notify_update
  AFTER UPDATE ON "ai_tasks"
  FOR EACH ROW
  WHEN (NEW."status" = 'PENDING' AND OLD."status" IS DISTINCT FROM 'PENDING')
  EXECUTE FUNCTION notify_ai_task_pending();
