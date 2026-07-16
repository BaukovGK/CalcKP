-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'TECHNOLOG';

-- AlterTable
ALTER TABLE "PriceItem" ADD COLUMN     "comment" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'руб',
ADD COLUMN     "discountPct" DOUBLE PRECISION,
ADD COLUMN     "priceBaseRub" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "PriceListVersion" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "label" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceListVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipeWeight" (
    "id" TEXT NOT NULL,
    "dn" INTEGER NOT NULL,
    "pn" DOUBLE PRECISION NOT NULL,
    "sn" INTEGER NOT NULL,
    "wallMm" DOUBLE PRECISION,
    "kgPerM" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "PipeWeight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PePipe" (
    "id" TEXT NOT NULL,
    "dn" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "odMm" DOUBLE PRECISION NOT NULL,
    "wallMm" TEXT,
    "kgPerM" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "PePipe_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PriceListVersion_version_key" ON "PriceListVersion"("version");

-- CreateIndex
CREATE UNIQUE INDEX "PipeWeight_dn_pn_sn_key" ON "PipeWeight"("dn", "pn", "sn");

-- CreateIndex
CREATE UNIQUE INDEX "PePipe_name_key" ON "PePipe"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PePipe_odMm_key" ON "PePipe"("odMm");

-- CreateIndex
CREATE INDEX "PePipe_dn_idx" ON "PePipe"("dn");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "PriceHistory_priceItemId_changedAt_idx" ON "PriceHistory"("priceItemId", "changedAt");

-- CreateIndex
CREATE INDEX "PriceItem_category_idx" ON "PriceItem"("category");

-- CreateIndex
CREATE UNIQUE INDEX "PriceItem_category_name_unit_key" ON "PriceItem"("category", "name", "unit");

-- AddForeignKey
ALTER TABLE "PriceListVersion" ADD CONSTRAINT "PriceListVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
