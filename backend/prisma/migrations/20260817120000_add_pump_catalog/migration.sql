-- CreateTable
CREATE TABLE "Pump" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "capacityMinM3h" DOUBLE PRECISION NOT NULL,
    "capacityMaxM3h" DOUBLE PRECISION NOT NULL,
    "headMinM" DOUBLE PRECISION NOT NULL,
    "headMaxM" DOUBLE PRECISION NOT NULL,
    "nozzleDiameterMm" INTEGER NOT NULL,

    CONSTRAINT "Pump_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Pump_name_key" ON "Pump"("name");
