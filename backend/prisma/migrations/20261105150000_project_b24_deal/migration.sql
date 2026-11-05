-- Проект ↔ сделка Битрикс24 (doc/План_Б24_сделка.md, этап 3): у сделки
-- сколько угодно проектов, у проекта не больше одной сделки.

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "b24CompanyId" TEXT,
ADD COLUMN     "b24DealId" TEXT;

-- CreateIndex
CREATE INDEX "Project_b24DealId_idx" ON "Project"("b24DealId");
