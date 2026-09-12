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

# Клиент PostgreSQL нужен точке входа: она снимает дамп ДО применения миграций
# (у `prisma migrate deploy` обратного хода нет). Мажорная версия должна
# совпадать с сервером — postgres:16 в docker-compose.yml.
# su-exec — переход на непривилегированного пользователя в точке входа
# (План_устранения 2.6): приложению права root не нужны.
RUN apk add --no-cache postgresql16-client su-exec

# Домашний каталог пользователя node: туда пишут npx и кеш npm, а от root
# унаследованный HOME=/root процессу приложения недоступен на запись.
ENV HOME=/home/node NPM_CONFIG_CACHE=/home/node/.npm

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

# Порядок запуска — в docker-entrypoint.sh: бэкап → миграции → сид → приложение.
# Сид досоздаёт недостающее, а справочники, которые ведёт технолог, заливает
# только в пустую базу. Его проверки на старте только предупреждают — строгие
# идут в CI (SEED_STRICT=1). Без сида приложение нерабочее: нет ни
# пользователей, ни прайса.
COPY --chmod=755 docker-entrypoint.sh /app/docker-entrypoint.sh
COPY --chmod=755 scripts/ /app/scripts/

# Коммит, из которого собран образ, — в /api/health (План_устранения 3.8).
# Задаёт docker-compose.yml из APP_BUILD; стоит последним, чтобы новый коммит
# не сбрасывал кэш тяжёлых слоёв выше.
ARG APP_BUILD=
ENV APP_BUILD=$APP_BUILD

CMD ["/app/docker-entrypoint.sh"]
