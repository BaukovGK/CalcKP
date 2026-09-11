-- План_устранения 3.1: версия расчёта — защита от записи поверх чужой правки.
-- AlterTable
ALTER TABLE "Estimate" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;
