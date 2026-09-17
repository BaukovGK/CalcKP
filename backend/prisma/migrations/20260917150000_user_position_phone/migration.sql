-- Учётные записи сотрудников: должность и рабочий телефон. Их печатает блок
-- исполнителя КП — раньше туда шли только имя и почта.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "position" TEXT;
ALTER TABLE "User" ADD COLUMN     "phone" TEXT;
