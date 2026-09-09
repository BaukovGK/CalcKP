-- Паспортные характеристики Q–H насосов (выгрузка VJ Select).
--
-- До этого подбор шёл по прямоугольной аппроксимации (Qmin…Qmax × 0…Hmax) и
-- принимал насосы, которые на своей кривой требуемый напор не выдают.

-- AlterTable
ALTER TABLE "Pump" ADD COLUMN "article" TEXT;
ALTER TABLE "Pump" ADD COLUMN "qNomM3h" DOUBLE PRECISION;
ALTER TABLE "Pump" ADD COLUMN "hNomM" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "PumpCurvePoint" (
    "id" SERIAL NOT NULL,
    "pumpId" INTEGER NOT NULL,
    "idx" INTEGER NOT NULL,
    "q" DOUBLE PRECISION NOT NULL,
    "h" DOUBLE PRECISION NOT NULL,
    "p2" DOUBLE PRECISION NOT NULL,
    "p1" DOUBLE PRECISION NOT NULL,
    "eff" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "PumpCurvePoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PumpCurvePoint_pumpId_idx_key" ON "PumpCurvePoint"("pumpId", "idx");

-- CreateIndex
CREATE INDEX "PumpCurvePoint_pumpId_q_idx" ON "PumpCurvePoint"("pumpId", "q");

-- AddForeignKey
ALTER TABLE "PumpCurvePoint" ADD CONSTRAINT "PumpCurvePoint_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "Pump"("id") ON DELETE CASCADE ON UPDATE CASCADE;
