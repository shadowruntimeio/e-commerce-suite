-- Attach images to bug reports. Unlike chat attachments these bytes are
-- persisted: ops/dev needs them while the bug is open. A scheduled sweep
-- (see apps/api/src/workers/scheduler.ts) deletes the rows once the
-- parent bug has been FIXED/WONTFIX/DUPLICATE for ≥ 7 days.

CREATE TABLE "bug_report_images" (
    "id" TEXT NOT NULL,
    "bugReportId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bug_report_images_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bug_report_images_bugReportId_idx" ON "bug_report_images"("bugReportId");

ALTER TABLE "bug_report_images"
  ADD CONSTRAINT "bug_report_images_bugReportId_fkey"
  FOREIGN KEY ("bugReportId") REFERENCES "bug_reports"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Cleanup sweep wants: find rows where parent bug is in a terminal state
-- and resolved long enough ago. Composite index makes that an index-only
-- range scan instead of a full table scan.
CREATE INDEX "bug_reports_status_resolvedAt_idx" ON "bug_reports"("status", "resolvedAt");
