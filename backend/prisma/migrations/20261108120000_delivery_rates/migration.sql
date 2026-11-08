-- Тарифы доставки: ставки по маршрутам из книги отдела закупок
-- (габарит, негабарит с разрешением, негабарит с сопровождением, ₽/а/м с НДС).
-- Заполняет сид (seed-data/delivery-rates.json), дальше ведёт закупка.

-- CreateTable
CREATE TABLE "DeliveryRate" (
    "id" TEXT NOT NULL,
    "num" INTEGER,
    "city" TEXT NOT NULL,
    "gabaritRub" DOUBLE PRECISION,
    "permitRub" DOUBLE PRECISION,
    "escortRub" DOUBLE PRECISION,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliveryRate_city_idx" ON "DeliveryRate"("city");
