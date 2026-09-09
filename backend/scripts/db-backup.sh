#!/bin/sh
# Бэкап базы НТТ Калькулятора.
#
# Запускается ВНУТРИ контейнера, у которого есть pg_dump той же мажорной версии,
# что и сервер (PostgreSQL 16): либо сервис `backup` из docker-compose.yml, либо
# сам backend перед миграциями (в его образ добавлен postgresql16-client).
#
# Формат — custom (-Fc): он сжат, позволяет частичное восстановление и не зависит
# от порядка объектов. Обычный SQL-дамп на прайсе в 1043 позиции и снапшотах
# дерева расчёта весит кратно больше и восстанавливается дольше.
#
#   BACKUP_DIR      куда писать (по умолчанию /backups)
#   BACKUP_KEEP     сколько последних файлов хранить (по умолчанию 30)
#   BACKUP_LABEL    метка в имени файла: ручной бэкап и предмиграционный
#                   должны различаться с первого взгляда
#   DATABASE_URL    строка подключения (или стандартные PG*)
#
# Код возврата 0 — дамп создан и проверен; иначе ненулевой.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_KEEP="${BACKUP_KEEP:-30}"
BACKUP_LABEL="${BACKUP_LABEL:-manual}"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "db-backup: DATABASE_URL не задан" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%d-%H%M%SZ)"
FILE="$BACKUP_DIR/ntt-$STAMP-$BACKUP_LABEL.dump"

echo "db-backup: снимаю дамп → $FILE"
# --no-owner/--no-privileges: восстанавливаем в контейнер, где роль называется
# иначе; владельцы и гранты исходной установки там всё равно не воспроизводятся.
pg_dump --dbname="$DATABASE_URL" \
        --format=custom \
        --compress=6 \
        --no-owner \
        --no-privileges \
        --file="$FILE"

# Дамп, который не читается, хуже отсутствия дампа: он создаёт ложную
# уверенность. Проверяем оглавление сразу после создания.
if ! pg_restore --list "$FILE" >/dev/null 2>&1; then
  echo "db-backup: дамп нечитаем, удаляю $FILE" >&2
  rm -f "$FILE"
  exit 1
fi

SIZE="$(wc -c < "$FILE" | tr -d ' ')"
echo "db-backup: готово, $SIZE байт, оглавление читается"

# Ротация: оставляем BACKUP_KEEP последних. Считаем только свои файлы, чтобы
# не тронуть чужое содержимое каталога.
if [ "$BACKUP_KEEP" -gt 0 ]; then
  # shellcheck disable=SC2012 # имена файлов заданы нами и пробелов не содержат
  ls -1t "$BACKUP_DIR"/ntt-*.dump 2>/dev/null | tail -n "+$((BACKUP_KEEP + 1))" | while read -r old; do
    echo "db-backup: удаляю старый $old"
    rm -f "$old"
  done
fi
