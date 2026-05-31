-- Image attachment metadata for chat messages. Bytes themselves live only in
-- AiTask.payload (cleared on DONE); these columns are for quota tracking and
-- "had an image" UI hints after the session is no longer in the browser.

ALTER TABLE "chat_messages"
  ADD COLUMN "attachmentMimeType" TEXT,
  ADD COLUMN "attachmentSizeBytes" INTEGER;

-- Cheap helper for the daily-quota count: list everyone's recent messages,
-- filter by attachmentMimeType IS NOT NULL, count via session join on userId.
CREATE INDEX "chat_messages_createdAt_idx" ON "chat_messages"("createdAt");
