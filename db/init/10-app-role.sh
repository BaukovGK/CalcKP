#!/bin/sh
# Роль приложения без прав суперпользователя (План_устранения 2.6).
#
# Выполняется образом postgres ТОЛЬКО при создании кластера (initdb), то есть
# на новой установке: у работающей базы каталог данных не пуст, и хуки не
# запускаются. Процедура переезда для уже работающей базы — в РАЗВЁРТЫВАНИЕ.md,
# раздел «Роль приложения без прав суперпользователя».
#
# Без APP_DB_PASSWORD ничего не делает: приложение ходит в базу ролью
# POSTGRES_USER, как раньше. Так новая установка получает разделение прав по
# желанию, а существующая — не ломается.
#
#   APP_DB_USER=ntt_app       имя роли приложения
#   APP_DB_PASSWORD=…         её пароль; пусто — роль не заводится
#
# Без `exit` намеренно: неисполняемый файл образ postgres не запускает, а
# подключает в свою оболочку (`source`), и `exit` оборвал бы создание базы.
set -eu

if [ -z "${APP_DB_PASSWORD:-}" ]; then
  echo "app-role: APP_DB_PASSWORD не задан — приложение будет ходить в базу ролью ${POSTGRES_USER}"
else
  APP_USER="${APP_DB_USER:-ntt_app}"
  echo "app-role: завожу роль $APP_USER — без SUPERUSER, CREATEDB и CREATEROLE"

  # Схема public с PostgreSQL 15 принадлежит владельцу базы, и CREATE в ней у
  # PUBLIC отобран: без смены владельца `prisma migrate deploy` не создаст ни
  # одной таблицы. Поэтому роль получает схему в собственность — этого хватает
  # для миграций, и только внутри своей базы.
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    -v app_user="$APP_USER" -v app_password="$APP_DB_PASSWORD" -v app_db="$POSTGRES_DB" <<'SQL'
CREATE ROLE :"app_user" LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT CONNECT ON DATABASE :"app_db" TO :"app_user";
ALTER SCHEMA public OWNER TO :"app_user";
SQL

  echo "app-role: роль $APP_USER владеет схемой public базы $POSTGRES_DB"
fi
