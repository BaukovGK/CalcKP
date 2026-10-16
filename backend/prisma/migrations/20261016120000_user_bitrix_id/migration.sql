-- Вход из Битрикс24 (ТЗ §10.3): учётная запись привязывается к сотруднику
-- портала по его ID. Один сотрудник — одна учётка, поэтому индекс уникальный;
-- непривязанных (null) может быть сколько угодно.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "bitrixUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_bitrixUserId_key" ON "User"("bitrixUserId");
