#!/bin/sh
# Восстановление базы НТТ Калькулятора из дампа.
#
# Операция РАЗРУШАЮЩАЯ: содержимое текущей базы заменяется содержимым дампа.
# Поэтому по умолчанию скрипт ничего не делает — нужен явный флаг --yes.
#
#   db-restore.sh --list                     показать доступные дампы
#   db-restore.sh --yes <файл|latest>        восстановить
#
#   BACKUP_DIR      где искать дампы (по умолчанию /backups)
#   MIGRATIONS_DIR  миграции этой версии программы (по умолчанию /app/prisma/migrations)
#   DATABASE_URL    строка подключения
#
# Перед восстановлением снимается страховочный дамп текущего состояния
# (метка `pre-restore`): если выяснится, что восстановили не то, вернуться
# будет куда.
#
# Миграции дампа сверяются с миграциями программы (План_устранения 3.3): дамп
# новее программы — отказ; старше — после восстановления перезапустите
# бэкенд, недостающие миграции применятся.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-/app/prisma/migrations}"
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

# ── Миграции дампа и программы ──────────────────────────────────────────────
TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT

# Имена применённых миграций — из данных _prisma_migrations в дампе (блок
# COPY): незавершённые (finished_at пуст) и откатанные не считаются.
pg_restore --file=- --data-only --table=_prisma_migrations "$TARGET" 2>/dev/null | awk '
  /^COPY .*_prisma_migrations/ {
    cols = $0
    sub(/^[^(]*\(/, "", cols); sub(/\).*$/, "", cols)
    n = split(cols, c, /, */)
    for (i = 1; i <= n; i++) {
      gsub(/"/, "", c[i])
      if (c[i] == "migration_name") name = i
      else if (c[i] == "finished_at") fin = i
      else if (c[i] == "rolled_back_at") rb = i
    }
    inside = 1
    next
  }
  inside && $0 == "\\." { inside = 0; next }
  inside && name {
    split($0, f, "\t")
    if ((fin && f[fin] == "\\N") || (rb && f[rb] != "\\N")) next
    print f[name]
  }
' | sort -u > "$TMPD/dump"
# shellcheck disable=SC2012
ls -1 "$MIGRATIONS_DIR" 2>/dev/null | grep -v '\.toml$' | sort -u > "$TMPD/code" || true
if [ ! -s "$TMPD/code" ]; then
  echo "db-restore: не найдены миграции программы в $MIGRATIONS_DIR — сверить дамп не с чем." >&2
  echo "            Укажите MIGRATIONS_DIR (в docker compose это делает сервис restore)." >&2
  exit 1
fi

UNKNOWN="$(comm -23 "$TMPD/dump" "$TMPD/code")"
MISSING="$(comm -13 "$TMPD/dump" "$TMPD/code")"

if [ -n "$UNKNOWN" ]; then
  echo "db-restore: дамп снят более новой версией программы — в нём миграции, которых она не знает:" >&2
  echo "$UNKNOWN" | sed 's/^/             /' >&2
  echo "            Восстановите его на той версии, которой он снят." >&2
  exit 1
fi
if [ -n "$MISSING" ]; then
  echo "db-restore: дамп старше программы — после восстановления перезапустите бэкенд, применятся миграции:"
  echo "$MISSING" | sed 's/^/             /'
fi

if [ -z "$CONFIRM" ]; then
  echo "db-restore: это заменит текущую базу содержимым $TARGET." >&2
  echo "            Повторите с флагом --yes, если действительно этого хотите." >&2
  exit 2
fi

echo "db-restore: страховочный дамп текущего состояния перед заменой"
BACKUP_LABEL=pre-restore BACKUP_DIR="$BACKUP_DIR" "$(dirname "$0")/db-backup.sh"

echo "db-restore: восстанавливаю из $TARGET"
# В чистую схему: --clean пересоздавал только объекты из дампа — таблицы и
# колонки более поздних миграций оставались, а _prisma_migrations
# откатывалась, и следующий старт падал на migrate deploy.
# --exit-on-error: молчаливое «восстановилось наполовину» опаснее отказа.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c 'SET client_min_messages TO warning; DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
pg_restore --dbname="$DATABASE_URL" \
           --no-owner --no-privileges \
           --exit-on-error \
           "$TARGET"

if [ -n "$MISSING" ]; then
  echo "db-restore: готово. Перезапустите бэкенд — он применит недостающие миграции,"
  echo "            сняв перед этим предмиграционный дамп:"
  echo "            docker compose restart backend"
else
  echo "db-restore: готово. Проверьте приложение и состояние миграций:"
  echo "            docker compose exec backend npx prisma migrate status"
fi
