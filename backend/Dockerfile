# ⚠️ НЕ ПРОВЕРЕН: Docker на машине разработки отсутствует (решение 2026-07-16).
# Рабочий путь развёртывания — ../verify.ps1.

FROM node:24-alpine AS build
WORKDIR /app

COPY package*.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma
# Полная установка: prisma generate нужен на этапе сборки.
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npx prisma generate && npm run build

# ── Рантайм ──────────────────────────────────────────────────────────────────
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
# exceljs и multer — рантайм-зависимости (импорт прайса, выгрузка Заявки),
# поэтому --omit=dev их не тронет. Проверено: они в dependencies.
RUN npm ci --omit=dev --no-audit --no-fund

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY prisma.config.ts ./
COPY prisma ./prisma

EXPOSE 3000

# Миграции и сид при старте: сид идемпотентен (upsert + skipDuplicates) и
# содержит проверки — упадёт, если ставка ФОТ или веса труб не нашлись.
CMD sh -c "npx prisma migrate deploy && node dist/app.js"
