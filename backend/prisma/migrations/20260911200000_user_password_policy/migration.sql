-- План_устранения 2.1 и 2.3: обязательная смена пароля и версия токенов.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;
