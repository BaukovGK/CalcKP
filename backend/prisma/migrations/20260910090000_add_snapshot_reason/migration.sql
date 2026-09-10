-- CreateEnum
CREATE TYPE "SnapshotReason" AS ENUM ('CREATE', 'MANUAL', 'KP');

-- AlterTable
ALTER TABLE "EstimateSnapshot" ADD COLUMN     "reason" "SnapshotReason" NOT NULL DEFAULT 'KP';
