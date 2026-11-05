-- Отправка КП в ленту сделки Битрикс24 (doc/План_Б24_сделка.md, этап 6).

-- AlterTable
ALTER TABLE "EstimateSnapshot" ADD COLUMN     "b24CommentId" TEXT,
ADD COLUMN     "b24Error" TEXT,
ADD COLUMN     "b24SentAt" TIMESTAMP(3);
