#!/bin/sh
# Включает HTTPS, если контейнер запущен с NGINX_TLS=1
# (docker-compose.https.yml). Образ nginx выполняет скрипты из
# /docker-entrypoint.d/ перед запуском nginx; упавший скрипт останавливает
# старт — лучше контейнер, который не поднялся с понятной ошибкой, чем
# молча работающий по HTTP.
set -eu

[ "${NGINX_TLS:-0}" = "1" ] || exit 0

for f in fullchain.pem privkey.pem; do
  if [ ! -r "/etc/nginx/tls/$f" ]; then
    echo "40-tls.sh: нет /etc/nginx/tls/$f — проверьте TLS_CERT_DIR в .env" >&2
    exit 1
  fi
done

cp /etc/nginx/ntt-https.conf /etc/nginx/conf.d/default.conf
echo "40-tls.sh: HTTPS включён (443), 80 переводит на https"
