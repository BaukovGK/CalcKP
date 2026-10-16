# ✅ Проверен: docker compose up поднимает стек с нуля (2026-07-17).
#
# Контекст сборки — КОРЕНЬ репозитория (см. docker-compose.yml): фронт
# импортирует мастер-шаблон только на этапе сида, но контекст оставлен общим
# на случай будущих общих файлов.

FROM node:24-alpine AS build
WORKDIR /app

COPY ntt-calculator/package*.json ./
RUN npm ci --no-audit --no-fund

COPY ntt-calculator/ ./
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build-only

# ── Раздача ──────────────────────────────────────────────────────────────────
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY ntt-calculator/nginx.conf /etc/nginx/conf.d/default.conf
# Заголовки безопасности — подключаются из nginx.conf (План_устранения 2.4).
COPY ntt-calculator/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
# Общее тело сервера для HTTP и HTTPS.
COPY ntt-calculator/nginx/app.conf /etc/nginx/snippets/app.conf
# HTTPS — вне conf.d, чтобы nginx его не подхватил сам: включает 40-tls.sh
# при NGINX_TLS=1 (docker-compose.https.yml). Бит исполнения задаётся здесь:
# из Windows-клона он теряется, а без него образ nginx скрипт пропустит.
COPY ntt-calculator/nginx/https.conf /etc/nginx/ntt-https.conf
COPY --chmod=755 ntt-calculator/nginx/40-tls.sh /docker-entrypoint.d/40-tls.sh
EXPOSE 80 443
