# ✅ Проверен: docker compose up поднимает стек с нуля (2026-07-17).

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

# Сид компилируется ОТДЕЛЬНО: tsconfig собирает только src/**, а seed.ts лежит
# в prisma/. В рантайм-образе нет ts-node-dev (он dev-зависимость), поэтому
# запускать .ts там нечем — нужен готовый .js.
RUN npx tsc prisma/seed.ts \
      --outDir dist-seed \
      --module commonjs --target ES2022 \
      --esModuleInterop --resolveJsonModule --skipLibCheck

# ── Рантайм ──────────────────────────────────────────────────────────────────
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
# exceljs и multer — рантайм-зависимости (импорт прайса, выгрузка Заявки),
# поэтому --omit=dev их не тронет. Проверено: они в dependencies.
RUN npm ci --omit=dev --no-audit --no-fund

COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-seed ./dist-seed
# Сид читает справочники как resolve(__dirname, 'seed-data') — кладём их рядом
# с СОБРАННЫМ сидом, иначе после компиляции путь не сойдётся.
COPY --from=build /app/prisma/seed-data ./dist-seed/seed-data
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY prisma.config.ts ./
COPY prisma ./prisma

EXPOSE 3000

# Миграции и сид при старте. Сид идемпотентен (upsert + createMany
# skipDuplicates) и содержит проверки — упадёт, если ставка ФОТ или
# контрольный вес трубы не нашлись. Без сида приложение нерабочее:
# нет ни пользователей, ни прайса.
CMD sh -c "npx prisma migrate deploy && node dist-seed/seed.js && node dist/app.js"
