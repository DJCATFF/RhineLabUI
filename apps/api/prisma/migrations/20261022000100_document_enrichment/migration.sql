ALTER TABLE "documents"
  ADD COLUMN "summary" TEXT,
  ADD COLUMN "keyPoints" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "category" TEXT,
  ADD COLUMN "enrichedAt" TIMESTAMP(3),
  ADD COLUMN "enrichmentError" TEXT;
