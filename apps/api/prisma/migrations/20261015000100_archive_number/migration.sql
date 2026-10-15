ALTER TABLE "documents" ADD COLUMN "archiveNumber" SERIAL NOT NULL;
CREATE UNIQUE INDEX "documents_archiveNumber_key" ON "documents"("archiveNumber");
