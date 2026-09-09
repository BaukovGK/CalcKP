#!/bin/sh
# Восстановление базы НТТ Калькулятора из дампа.
#
# Операция РАЗРУШАЮЩАЯ: содержимое текущей базы заменяется содержимым дампа.
# Поэтому по умолчанию скрипт ничего не делает — нужен явный флаг --yes.
#
#   db-restore.sh --list                     показать доступные дампы
#   db-restore.sh --yes <файл|latest>        восстановить
#
#   BACKUP_DIR    где искать дампы (по умолчанию /backups)
#   DATABASE_URL  строка подключения
#
# Перед восстановлением снимается страховочный дамп текущего состояния
# (метка `pre-restore`): если выяснится, что восстановили не то, вернуться
# будет куда.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
CONFIRM=""
TARGET=""

usage() {
  cat >&2 <<'EOF'
Использование:
  db-restore.sh --list                показать дампы
  db-restore.sh --yes <файл|latest>   восстановить (РАЗРУШАЮЩАЯ операция)
EOF
  exit 2
}

for arg in "$@"; do
  case "$arg" in
    --list)
      # shellcheck disable=SC2012
      ls -1t "$BACKUP_DIR"/ntt-*.dump 2>/dev/null || echo "(дампов нет в $BACKUP_DIR)"
      exit 0
      ;;
    --yes) CONFIRM=1 ;;
    -*) usage ;;
    *) TARGET="$arg" ;;
  esac
done

[ -n "$TARGET" ] || usage

if [ -z "${DATABASE_URL:-}" ]; then
  echo "db-restore: DATABASE_URL не задан" >&2
  exit 1
fi

if [ "$TARGET" = "latest" ]; then
  # shellcheck disable=SC2012
  TARGET="$(ls -1t "$BACKUP_DIR"/ntt-*.dump 2>/dev/null | head -n 1 || true)"
  [ -n "$TARGET" ] || { echo "db-restore: в $BACKUP_DIR нет дампов" >&2; exit 1; }
fi

case "$TARGET" in
  /*) ;;
  *) TARGET="$BACKUP_DIR/$TARGET" ;;
esac

[ -f "$TARGET" ] || { echo "db-restore: файл не найден: $TARGET" >&2; exit 1; }

if ! pg_restore --list "$TARGET" >/dev/null 2>&1; then
  echo "db-restore: файл не является читаемым дампом: $TARGET" >&2
  exit 1
fi

if [ -z "$CONFIRM" ]; then
  echo "db-restore: это заменит текущую базу содержимым $TARGET." >&2
  echo "            Повторите с флагом --yes, если действительно этого хотите." >&2
  exit 2
fi

echo "db-restore: страховочный дамп текущего состояния перед заменой"
BACKUP_LABEL=pre-restore BACKUP_DIR="$BACKUP_DIR" "$(dirname "$0")/db-backup.sh"

echo "db-restore: восстанавливаю из $TARGET"
# --clean --if-exists: дамп сначала удаляет свои объекты, поэтому восстановление
# в непустую базу не рассыпается на конфликтах имён.
# --exit-on-error: молчаливое «восстановилось наполовину» опаснее отказа.
pg_restore --dbname="$DATABASE_URL" \
           --clean --if-exists \
           --no-owner --no-privileges \
           --exit-on-error \
           "$TARGET"

echo "db-restore: готово. Проверьте приложение и состояние миграций:"
echo "            docker compose exec backend npx prisma migrate status"
