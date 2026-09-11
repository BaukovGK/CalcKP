-- Редактор шаблонов, этап 2: каталог узлов (NodeDef) и шаблоны изделий
-- (ProductTemplate) с неизменяемыми опубликованными версиями; версия шаблона
-- в снапшоте расчёта.

-- AlterTable
ALTER TABLE "EstimateSnapshot" ADD COLUMN     "templateVersion" INTEGER;

-- CreateTable
CREATE TABLE "NodeDef" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "draft" JSONB,
    "activeVersion" INTEGER,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NodeDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeDefVersion" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "body" JSONB NOT NULL,
    "note" TEXT,
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NodeDefVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductTemplate" (
    "id" TEXT NOT NULL,
    "deviceType" "DeviceType" NOT NULL,
    "draft" JSONB,
    "activeVersion" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductTemplateVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "body" JSONB NOT NULL,
    "note" TEXT,
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NodeDef_code_key" ON "NodeDef"("code");

-- CreateIndex
CREATE UNIQUE INDEX "NodeDefVersion_nodeId_version_key" ON "NodeDefVersion"("nodeId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ProductTemplate_deviceType_key" ON "ProductTemplate"("deviceType");

-- CreateIndex
CREATE UNIQUE INDEX "ProductTemplateVersion_templateId_version_key" ON "ProductTemplateVersion"("templateId", "version");

-- AddForeignKey
ALTER TABLE "NodeDefVersion" ADD CONSTRAINT "NodeDefVersion_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "NodeDef"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeDefVersion" ADD CONSTRAINT "NodeDefVersion_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTemplateVersion" ADD CONSTRAINT "ProductTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ProductTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTemplateVersion" ADD CONSTRAINT "ProductTemplateVersion_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

