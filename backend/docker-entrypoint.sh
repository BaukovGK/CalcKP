#!/bin/sh
# Точка входа контейнера backend: бэкап → миграции → сид → запуск.
#
# Смысл в первом шаге. Миграции применяются автоматически при каждом старте
# (`prisma migrate deploy`), а обратного хода у них нет: Prisma не умеет
# откатывать применённую миграцию, и единственный путь назад — восстановление
# из дампа. Поэтому дамп снимается ДО миграций, и по умолчанию его неудача
# останавливает запуск: применить необратимое изменение к базе, для которой
# нет точки возврата, хуже, чем не подняться.
#
#   BACKUP_BEFORE_MIGRATE=require  (по умолчанию) бэкап обязателен: не снялся —
#                                  контейнер не стартует
#                        =try      попробовать, но продолжить при неудаче
#                        =off      не снимать (например, при отдельном
#                                  внешнем бэкапе)
#   BACKUP_DIR=/backups            каталог дампов (том из docker-compose.yml)
#   RUN_SEED=1                     запускать сид (по умолчанию да)
#   APP_USER=node                  от кого работает приложение
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
APP_USER="${APP_USER:-node}"

# Приложение работает НЕ от root (План_устранения 2.6): прав суперпользователя
# ему не нужно ни для чего. Каталог дампов монтируется с хоста, и его владельца
# изнутри контейнера иначе не сменить, поэтому точка входа стартует от root,
# отдаёт каталог приложению и тут же переходит на его пользователя. Шагов на
# сервере это не требует: существующая установка после обновления образа
# получает и права на каталог, и непривилегированный процесс.
if [ "$(id -u)" = 0 ]; then
  mkdir -p "$BACKUP_DIR"
  if [ "$(stat -c %u "$BACKUP_DIR")" != "$(id -u "$APP_USER")" ]; then
    echo "entrypoint: отдаю каталог дампов $BACKUP_DIR пользователю $APP_USER"
    chown -R "$APP_USER" "$BACKUP_DIR" ||
      echo "entrypoint: сменить владельца $BACKUP_DIR не удалось — проверьте права на хосте" >&2
  fi
  echo "entrypoint: дальше — от пользователя $APP_USER (uid $(id -u "$APP_USER"))"
  exec su-exec "$APP_USER" "$0" "$@"
fi

MODE="${BACKUP_BEFORE_MIGRATE:-require}"

pending_migrations() {
  # Ненулевой код или слово о неприменённых миграциях — значит миграции есть.
  npx prisma migrate status 2>&1 | grep -qiE "following migration|not yet been applied|pending"
}

database_has_tables() {
  # На первом запуске база пуста: снимать с неё дамп нечего, а отсутствие
  # таблиц — не повод отказываться стартовать.
  psql "$DATABASE_URL" -tAc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null \
    | grep -qvE '^0?$'
}

backup_before_migrate() {
  if [ "$MODE" = "off" ]; then
    echo "entrypoint: бэкап перед миграциями отключён (BACKUP_BEFORE_MIGRATE=off)"
    return 0
  fi

  if ! database_has_tables; then
    echo "entrypoint: база пуста — это первый запуск, бэкап не нужен"
    return 0
  fi

  if ! pending_migrations; then
    echo "entrypoint: неприменённых миграций нет — бэкап не нужен"
    return 0
  fi

  echo "entrypoint: есть неприменённые миграции, снимаю дамп до их применения"
  if BACKUP_LABEL=pre-migrate /app/scripts/db-backup.sh; then
    return 0
  fi

  if [ "$MODE" = "try" ]; then
    echo "entrypoint: дамп не снят, но BACKUP_BEFORE_MIGRATE=try — продолжаю" >&2
    return 0
  fi

  echo "entrypoint: дамп не снят — миграции НЕ применяются." >&2
  echo "            Откатить их будет нечем. Проверьте том бэкапов и права на запись," >&2
  echo "            либо запустите с BACKUP_BEFORE_MIGRATE=try, приняв риск." >&2
  return 1
}

backup_before_migrate

echo "entrypoint: применяю миграции"
npx prisma migrate deploy

if [ "${RUN_SEED:-1}" = "1" ]; then
  # Мягкий режим (без SEED_STRICT): расхождения с мастер-шаблоном — только
  # предупреждения, справочники, которые ведёт технолог, сид не трогает.
  echo "entrypoint: сид справочников"
  node dist-seed/seed.js
fi

echo "entrypoint: запускаю приложение"
exec node dist/app.js
