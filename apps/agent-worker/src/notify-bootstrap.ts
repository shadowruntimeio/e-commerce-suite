import { Client } from 'pg'

/**
 * Idempotent installer for the `notify_ai_task_pending` function + the two
 * triggers on `ai_tasks` that fire pg_notify('ai_task_new', task.id) whenever
 * a row enters PENDING.
 *
 * Why this lives in the worker (not in a Prisma migration):
 *  - prod is shaped by `prisma db push` on every API redeploy, which ignores
 *    migration SQL files.
 *  - the trigger is meaningful only when the worker is running anyway, so
 *    coupling the lifetime here keeps the dependency local and self-healing.
 *  - safe to run every boot: CREATE OR REPLACE FUNCTION + DROP/CREATE TRIGGER.
 */
const BOOTSTRAP_SQL = `
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
`

export async function ensureNotifyTrigger(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    await client.query(BOOTSTRAP_SQL)
  } finally {
    await client.end()
  }
}
