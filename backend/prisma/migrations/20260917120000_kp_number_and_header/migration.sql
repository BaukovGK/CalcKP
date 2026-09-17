-- Печатная форма КП по образцу коммерческого отдела: исходящий номер и шапка
-- (условия, подпись, правленый состав) хранятся вместе со слепком, по
-- которому КП выпущено. Номер сквозной — его выдаёт счётчик KpCounter.

-- AlterTable
ALTER TABLE "EstimateSnapshot" ADD COLUMN     "kpNumber" TEXT;
ALTER TABLE "EstimateSnapshot" ADD COLUMN     "kpJson" JSONB;

-- CreateTable
CREATE TABLE "KpCounter" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "KpCounter_pkey" PRIMARY KEY ("id")
);

-- Счётчик существует с первой выкладки: выпуск КП только увеличивает его.
INSERT INTO "KpCounter" ("id", "last") VALUES (1, 0);
