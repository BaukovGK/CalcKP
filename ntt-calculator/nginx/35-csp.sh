#!/bin/sh
# Кому разрешено показывать приложение во фрейме (CSP frame-ancestors).
# Образ nginx выполняет скрипты из /docker-entrypoint.d/ перед запуском.
#
# BITRIX_PORTAL задан (тот же, что у бэкенда) — только сам сайт и портал
# компании: заводить порталы Битрикс24 может кто угодно, и разрешать их все
# незачем. Не задан — любой облачный Битрикс24, как было до настройки.
set -eu

conf=/etc/nginx/snippets/security-headers.conf
portal="$(printf '%s' "${BITRIX_PORTAL:-}" | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#/+$##')"

if [ -z "$portal" ]; then
  ancestors="'self' https://*.bitrix24.ru https://*.bitrix24.com"
elif printf '%s' "$portal" | grep -Eq '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'; then
  ancestors="'self' https://$portal"
else
  # Значение попадает в заголовок — лишние символы туда не пускаем.
  echo "35-csp.sh: BITRIX_PORTAL «$portal» — не адрес сайта; проверьте .env" >&2
  exit 1
fi

# Подстановка одна на контейнер: при перезапуске меток уже нет, а смена
# BITRIX_PORTAL пересоздаёт контейнер с чистым файлом из образа.
sed -i "s#__FRAME_ANCESTORS__#$ancestors#g" "$conf"
echo "35-csp.sh: frame-ancestors $ancestors"
