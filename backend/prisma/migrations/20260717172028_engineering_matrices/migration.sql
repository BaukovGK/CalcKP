-- CreateEnum
CREATE TYPE "MatrixKind" AS ENUM ('SHELL', 'ELLIPTIC_BOTTOM');

-- CreateTable
CREATE TABLE "EngineeringMatrix" (
    "id" SERIAL NOT NULL,
    "kind" "MatrixKind" NOT NULL,
    "d" INTEGER NOT NULL,
    "lengthMm" INTEGER NOT NULL,
    "massKg" DOUBLE PRECISION NOT NULL,
    "thicknessMm" DOUBLE PRECISION,

    CONSTRAINT "EngineeringMatrix_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NozzleNorm" (
    "id" SERIAL NOT NULL,
    "dn" INTEGER NOT NULL,
    "odMm" DOUBLE PRECISION,
    "minLengthMm" DOUBLE PRECISION,
    "moldingMassKg" DOUBLE PRECISION NOT NULL,
    "h1Mm" DOUBLE PRECISION,
    "s1Mm" DOUBLE PRECISION,
    "flangeMassKg" DOUBLE PRECISION,
    "bolt" TEXT,
    "boltCount" INTEGER,

    CONSTRAINT "NozzleNorm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EngineeringMatrix_kind_idx" ON "EngineeringMatrix"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "EngineeringMatrix_kind_d_lengthMm_key" ON "EngineeringMatrix"("kind", "d", "lengthMm");

-- CreateIndex
CREATE UNIQUE INDEX "NozzleNorm_dn_key" ON "NozzleNorm"("dn");
