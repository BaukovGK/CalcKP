# ⚠️ НЕ ПРОВЕРЕН: Docker на машине разработки отсутствует (решение 2026-07-16).
# Рабочий путь развёртывания — ../verify.ps1.
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
EXPOSE 80
