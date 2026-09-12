#!/usr/bin/env bash
# Готова ли машина к выкладке НТТ Калькулятора.
#
# Запускается когда угодно — до первого запуска и после: ничего не меняет,
# только проверяет и объясняет, что не так. Возвращает 1, если есть отказы.
#
#   bash deploy/preflight.sh          из каталога репозитория
set -uo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
FAIL=0

ok()   { echo "  ✓ $*"; }
warn() { echo "  ! $*"; }
bad()  { echo "  ✗ $*"; FAIL=1; }
part() { echo; echo "== $* =="; }

part "Система"
if [ -r /etc/os-release ]; then
  . /etc/os-release
  ok "${PRETTY_NAME:-неизвестная система}"
fi
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)
SWAP_MB=$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)
if [ "$MEM_MB" -ge 2048 ] || [ "$SWAP_MB" -ge 1024 ]; then
  ok "память ${MEM_MB} МБ, swap ${SWAP_MB} МБ"
else
  warn "память ${MEM_MB} МБ без swap — сборка фронта может упасть по памяти (bootstrap.sh добавляет 2 ГБ swap)"
fi
FREE_GB=$(df -BG --output=avail "$ROOT" 2>/dev/null | tail -1 | tr -dc '0-9')
if [ -n "${FREE_GB:-}" ] && [ "$FREE_GB" -lt 5 ]; then
  warn "на диске ${FREE_GB} ГБ: образам, БД и дампам нужно больше"
else
  ok "на диске ${FREE_GB:-?} ГБ"
fi

part "Docker"
if command -v docker >/dev/null; then
  ok "$(docker --version)"
  if docker compose version >/dev/null 2>&1; then
    ok "$(docker compose version)"
  else
    bad "нет docker compose v2 — стек описан форматом v2 (docker-compose.yml)"
  fi
  if docker info >/dev/null 2>&1; then
    ok "демон отвечает от пользователя $(id -un)"
  else
    bad "демон не отвечает: нет прав (нужна группа docker) или служба не запущена"
  fi
else
  bad "Docker не установлен"
fi

part "Репозиторий"
if [ -d .git ]; then
  ok "ветка $(git rev-parse --abbrev-ref HEAD), коммит $(git rev-parse --short HEAD)"
  git remote get-url origin >/dev/null 2>&1 && ok "origin: $(git remote get-url origin | sed 's#//[^@]*@#//***@#')"
  [ -n "$(git status --porcelain)" ] && warn "рабочее дерево изменено — деплой затрёт правки (git reset --hard)"
else
  bad "это не клон репозитория: $ROOT"
fi

part "Файл .env"
if [ -f .env ]; then
  ok ".env есть"
  PERM=$(stat -c %a .env)
  [ "$PERM" = 600 ] || warn "права $PERM: в .env пароль БД и JWT-секрет, ожидается 600 (chmod 600 .env)"
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
  [ -n "${POSTGRES_PASSWORD:-}" ] && ok "POSTGRES_PASSWORD задан" || bad "POSTGRES_PASSWORD пуст — стек не поднимется"
  if [ -z "${JWT_SECRET:-}" ]; then
    bad "JWT_SECRET пуст — бэкенд не стартует"
  elif [ "${#JWT_SECRET}" -lt 32 ]; then
    bad "JWT_SECRET короче 32 знаков — бэкенд не стартует"
  elif echo "$JWT_SECRET" | grep -qiE 'change|secret|example|password|123456'; then
    bad "JWT_SECRET похож на значение из шаблона — бэкенд не стартует"
  else
    ok "JWT_SECRET годится"
  fi
  case "${PUBLIC_URL:-}" in
    http://localhost*|"") warn "PUBLIC_URL=${PUBLIC_URL:-пусто}: снаружи по нему не зайти и CORS отклонит браузер" ;;
    *) ok "PUBLIC_URL=$PUBLIC_URL" ;;
  esac
  [ -n "${APP_DB_PASSWORD:-}" ] && ok "роль приложения ${APP_DB_USER:-ntt_app} (без прав суперпользователя)" \
    || warn "APP_DB_PASSWORD пуст: приложение будет ходить в базу ролью POSTGRES_USER (см. «Права» в РАЗВЁРТЫВАНИЕ.md)"
else
  bad "нет .env — создайте из .env.example (bootstrap.sh делает это сам)"
fi

part "Порты и каталоги"
PORT="${HTTP_PORT:-80}"
if command -v ss >/dev/null && ss -lnt 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$PORT\$"; then
  # Занять порт может и наш же nginx — это нормально для работающей установки.
  if docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null | grep -q ":$PORT->"; then
    ok "порт $PORT занят самим стеком"
  else
    bad "порт $PORT занят посторонней службой — стек не поднимется"
  fi
else
  ok "порт $PORT свободен"
fi
if [ -d backups ]; then
  OWNER=$(stat -c %u backups)
  [ "$OWNER" = 1000 ] && ok "каталог дампов backups/ принадлежит uid 1000" \
    || warn "backups/ принадлежит uid $OWNER: точка входа контейнера выставит права сама при старте"
else
  ok "каталог дампов создастся при первом запуске"
fi

part "Стек"
if docker compose ps --status running --format '{{.Service}}' 2>/dev/null | grep -q .; then
  docker compose ps --format '  ✓ {{.Service}}: {{.Status}}' 2>/dev/null
  HEALTH=$(curl -fsS "http://127.0.0.1:$PORT/api/health" 2>/dev/null || true)
  [ -n "$HEALTH" ] && ok "health: $HEALTH" || warn "health не ответил на 127.0.0.1:$PORT — стек ещё поднимается или порт другой"
else
  ok "стек не запущен (первый запуск: docker compose up -d --build)"
fi

echo
if [ "$FAIL" = 0 ]; then
  echo "Отказов нет. Предупреждения выше — на ваше усмотрение."
else
  echo "Есть отказы (✗) — выкладка на такой машине не пройдёт."
fi
exit "$FAIL"
