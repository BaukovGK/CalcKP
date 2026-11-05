-- Ключи сотрудников к порталу Битрикс24 для вызовов REST от их имени
-- (doc/План_Б24_сделка.md). Удаление учётки удаляет и ключ.

-- CreateTable
CREATE TABLE "B24Token" (
    "userId" TEXT NOT NULL,
    "bitrixUserId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "B24Token_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "B24Token" ADD CONSTRAINT "B24Token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
