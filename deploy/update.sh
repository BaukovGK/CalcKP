#!/usr/bin/env bash
# Обновить установку до состояния главной ветки и пересобрать стек.
#
# Один и тот же шаг для всех способов выкладки на машину, до которой GitHub
# достучаться не может (внутренняя сеть): его запускает агент GitHub на самой
# машине (задача `deploy-local` в ci-cd.yml) либо cron. Делает ровно то же,
# что делал бы деплой по SSH.
#
#   bash deploy/update.sh              обновить до origin/master
#   REF=dev bash deploy/update.sh      до другой ветки
#   bash deploy/update.sh --if-changed выйти молча, если новых коммитов нет
#
# Рабочее дерево приводится к ветке ЖЁСТКО (`reset --hard`): правки, сделанные
# на машине в отслеживаемых файлах, будут затёрты — так же, как при деплое по
# SSH. `.env`, каталог дампов и тома Docker не отслеживаются и переживают
# обновление.
set -euo pipefail

cd "$(dirname "$0")/.."
DIR="$PWD"
REF="${REF:-master}"
IF_CHANGED=0
[ "${1:-}" = "--if-changed" ] && IF_CHANGED=1

[ -d .git ] || { echo "update: $DIR — не клон репозитория" >&2; exit 1; }
[ -f .env ] || { echo "update: нет $DIR/.env — сначала подготовьте машину (deploy/bootstrap.sh)" >&2; exit 1; }

# Две выкладки разом (агент и cron, или два пуша подряд) пересобирали бы стек
# одновременно. Второй запуск просто уходит: его работу сделает первый.
LOCK="$DIR/.deploy.lock"
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "update: обновление уже идёт — выхожу"
  exit 0
fi

echo "update: $(date '+%F %T') · ветка $REF · каталог $DIR"
git fetch --all --quiet --prune

BEFORE="$(git rev-parse HEAD)"
AFTER="$(git rev-parse "origin/$REF")"
# Неотслеживаемые файлы (дампы, .env, заметки администратора) поводом для
# пересборки не считаются — их reset и не трогает. Правки отслеживаемых считаются:
# установка разошлась с веткой, и её надо вернуть.
DIRTY="$(git status --porcelain --untracked-files=no)"
if [ "$BEFORE" = "$AFTER" ] && [ "$IF_CHANGED" = 1 ] && [ -z "$DIRTY" ]; then
  echo "update: новых коммитов нет — пересборка не нужна"
  exit 0
fi

git reset --hard "origin/$REF" --quiet
echo "update: $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"

# Коммит сборки уходит в /api/health: по нему видно, что развёрнуто
# (План_устранения 3.8).
export APP_BUILD="$(git rev-parse --short HEAD)"

# --wait: не «команда прошла», а «бэкенд стал healthy». Не поднялся за три
# минуты — выкладка неудачна, и в логе видно почему.
if docker compose up -d --build --remove-orphans --wait --wait-timeout 180; then
  docker image prune -f >/dev/null || true
  echo "update: готово, сборка $APP_BUILD"
else
  echo "update: стек не поднялся за 3 минуты — хвост логов бэкенда:" >&2
  docker compose logs --tail=150 backend >&2 || true
  exit 1
fi
