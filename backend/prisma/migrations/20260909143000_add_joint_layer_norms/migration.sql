-- CreateTable
CREATE TABLE "JointLayerNorm" (
    "id" SERIAL NOT NULL,
    "d" INTEGER NOT NULL,
    "pn" INTEGER NOT NULL,
    "odMm" DOUBLE PRECISION,
    "hMm" DOUBLE PRECISION,
    "sMm" DOUBLE PRECISION,
    "xMm" DOUBLE PRECISION,
    "yMm" DOUBLE PRECISION,
    "massKg" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "JointLayerNorm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JointLayerNorm_d_idx" ON "JointLayerNorm"("d");

-- CreateIndex
CREATE UNIQUE INDEX "JointLayerNorm_d_pn_key" ON "JointLayerNorm"("d", "pn");
