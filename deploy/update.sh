#!/usr/bin/env bash
# Обновить установку до состояния главной ветки и пересобрать стек.
#
# Один и тот же шаг для всех способов выкладки на машину, до которой GitHub
# достучаться не может (внутренняя сеть): автомат по cron (deploy/autoupdate.sh),
# агент GitHub на машине (задача `deploy-local` в ci-cd.yml) и выкладка руками.
#
#   bash deploy/update.sh                          обновить до origin/master сейчас
#   bash deploy/update.sh --if-changed --wait-green так работает автомат
#   bash deploy/update.sh --check [коммит]         что скажут проверки GitHub, ничего не меняя
#   REF=dev bash deploy/update.sh                  до другой ветки
#
#   --if-changed   молча выйти, если новых коммитов нет;
#   --wait-green   выкладывать коммит, только когда его проверки в GitHub
#                  (тесты, типы, линт, документы) завершились и зелёные: пока
#                  идут — ждать следующего запуска, красные — не выкладывать.
#                  Статус читается из открытого API GitHub, токен не нужен, пока
#                  репозиторий публичный; закрытому — GITHUB_TOKEN в окружении.
#
# Рабочее дерево приводится к ветке ЖЁСТКО (`reset --hard`): правки, сделанные
# на машине в отслеживаемых файлах, будут затёрты. `.env`, каталог дампов и
# тома Docker не отслеживаются и переживают обновление.
set -euo pipefail

# Всё тело — в функции, а вызов — последней строкой: скрипт обновляет сам себя
# (`git reset --hard`), и bash, читающий файл по ходу выполнения, иначе мог бы
# дочитать уже новую версию с середины.
main() {
  cd "$(dirname "$0")/.."
  local dir="$PWD" ref="${REF:-master}"
  local if_changed=0 wait_green=0 check_only="" arg
  while [ $# -gt 0 ]; do
    arg="$1"
    case "$arg" in
      --if-changed) if_changed=1 ;;
      --wait-green) wait_green=1 ;;
      --check) check_only="${2:-HEAD-of-$ref}"; [ $# -gt 1 ] && shift ;;
      -h|--help) sed -n '2,23p' "$0"; return 0 ;;
      *) echo "update: неизвестный ключ $arg" >&2; return 2 ;;
    esac
    shift
  done

  [ -d .git ] || { echo "update: $dir — не клон репозитория" >&2; return 1; }

  if [ -n "$check_only" ]; then
    git fetch --quiet origin "$ref"
    local sha
    if [ "$check_only" = "HEAD-of-$ref" ]; then sha="$(git rev-parse "origin/$ref")"; else sha="$(git rev-parse "$check_only")"; fi
    local state; state="$(ci_state "$sha")"
    echo "update: $(git rev-parse --short "$sha") — проверки GitHub: $state"
    return 0
  fi

  [ -f .env ] || { echo "update: нет $dir/.env — сначала подготовьте машину (deploy/bootstrap.sh)" >&2; return 1; }

  # Две выкладки разом (автомат и человек, или два запуска cron подряд, пока
  # идёт сборка) пересобирали бы стек одновременно. Второй запуск уходит.
  exec 9>"$dir/.deploy.lock"
  if ! flock -n 9; then
    [ "$if_changed" = 1 ] || echo "update: обновление уже идёт — выхожу"
    return 0
  fi

  git fetch --all --quiet --prune

  local before after dirty
  before="$(git rev-parse HEAD)"
  after="$(git rev-parse "origin/$ref")"
  # Неотслеживаемые файлы (дампы, .env, заметки администратора) поводом для
  # пересборки не считаются — их reset и не трогает. Правки отслеживаемых
  # считаются: установка разошлась с веткой, и её надо вернуть.
  dirty="$(git status --porcelain --untracked-files=no)"
  if [ "$before" = "$after" ] && [ "$if_changed" = 1 ] && [ -z "$dirty" ]; then
    # Автомат запускается каждые несколько минут: «ничего нового» в журнал не
    # пишется, иначе он рос бы на сотни строк в день.
    return 0
  fi

  local short; short="$(git rev-parse --short "$after")"
  if [ "$wait_green" = 1 ] && [ "$before" != "$after" ]; then
    local state; state="$(ci_state "$after")"
    case "$state" in
      green) ;;
      pending|none)
        # Проверки ещё идут или не начались: решит следующий запуск.
        log_once "$after:$state" "update: $short — проверки GitHub ещё не завершились, жду"
        return 0 ;;
      red:*)
        log_once "$after:red" "update: $short — проверки GitHub красные (${state#red:}), не выкладываю"
        return 0 ;;
      *)
        log_once "$after:unknown" "update: $short — статус проверок GitHub не получен ($state), не выкладываю"
        return 0 ;;
    esac
  fi

  echo "update: $(date '+%F %T') · ветка $ref · каталог $dir"
  git reset --hard "origin/$ref" --quiet
  echo "update: $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"

  # Коммит сборки уходит в /api/health: по нему видно, что развёрнуто
  # (План_устранения 3.8).
  export APP_BUILD; APP_BUILD="$(git rev-parse --short HEAD)"

  # --wait: не «команда прошла», а «бэкенд стал healthy». Не поднялся за три
  # минуты — выкладка неудачна, и в журнале видно почему.
  if docker compose up -d --build --remove-orphans --wait --wait-timeout 180; then
    docker image prune -f >/dev/null || true
    echo "update: готово, сборка $APP_BUILD"
  else
    echo "update: стек не поднялся за 3 минуты — хвост логов бэкенда:" >&2
    docker compose logs --tail=150 backend >&2 || true
    return 1
  fi
}

# Статус проверок GitHub для коммита: green · pending · none · red:<имена> ·
# error:<что>. Берутся последние запуски каждой задачи (фильтр latest по
# умолчанию): перезапуск упавшей задачи, прошедший зелёным, коммит пропускает.
# Пропущенные задачи (выкладка при DEPLOY_MODE не задан) зелёному не мешают.
ci_state() {
  local sha="$1" slug url auth=() body
  slug="$(git remote get-url origin | sed -E 's#^.*github\.com[:/]##; s#\.git$##')"
  url="https://api.github.com/repos/$slug/commits/$sha/check-runs?per_page=100"
  [ -n "${GITHUB_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $GITHUB_TOKEN")
  if ! body="$(curl -fsS --max-time 20 -H 'Accept: application/vnd.github+json' "${auth[@]}" "$url" 2>&1)"; then
    echo "error:${body:0:80}"
    return 0
  fi
  echo "$body" | jq -r '
    [.check_runs[]] as $runs
    | if ($runs | length) == 0 then "none"
      elif any($runs[]; .status != "completed") then "pending"
      else
        ([$runs[] | select(.conclusion | IN("success", "skipped", "neutral") | not) | .name] | unique) as $bad
        | if ($bad | length) > 0 then "red:" + ($bad | join(", "))
          elif any($runs[]; .conclusion == "success") then "green"
          else "none" end
      end'
}

# Одна и та же причина ожидания не пишется в журнал на каждом запуске cron —
# только когда меняется (новый коммит или новое состояние).
log_once() {
  local key="$1" msg="$2" mark
  mark="$(dirname "$0")/../.deploy.last"
  if [ "$(cat "$mark" 2>/dev/null)" != "$key" ]; then
    echo "$(date '+%F %T') $msg"
    echo "$key" > "$mark"
  fi
}

main "$@"
