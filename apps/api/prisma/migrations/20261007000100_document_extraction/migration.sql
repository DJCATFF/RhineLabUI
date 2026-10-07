ALTER TABLE "documents"
  ADD COLUMN "text" TEXT,
  ADD COLUMN "extractionError" TEXT,
  ADD COLUMN "extractionAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "extractedAt" TIMESTAMP(3);
