#!/usr/bin/env bash
# Автомат обновления: машина сама выкладывает новые коммиты главной ветки.
#
# GitHub до машины во внутренней сети не достучится, поэтому ходит она сама:
# cron раз в несколько минут запускает `update.sh --if-changed --wait-green`.
# Новый коммит в master выкладывается, когда его проверки в GitHub (тесты,
# типы, линт, документы) завершились зелёными; красный — не выкладывается.
# Пока нового нет, запуск ничего не делает и в журнал не пишет.
#
# Запускать под пользователем, которому принадлежит установка (deploy):
#
#   bash deploy/autoupdate.sh install [минуты]   включить (по умолчанию каждые 3 мин)
#   bash deploy/autoupdate.sh status             что включено, что развёрнуто, что скажут проверки
#   bash deploy/autoupdate.sh remove             выключить
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$HOME/ntt-autoupdate.log"
MARK="# ntt-autoupdate"

# Crontab без нашей строки. `crontab -l` без crontab и `grep`, не нашедший
# строк, завершаются с ошибкой — это не повод обрывать скрипт.
current_crontab() { crontab -l 2>/dev/null | grep -vF "$MARK" || true; }

case "${1:-status}" in
  install)
    every="${2:-3}"
    [[ "$every" =~ ^[0-9]+$ ]] && [ "$every" -ge 1 ] && [ "$every" -le 59 ] ||
      { echo "Интервал — целое число минут от 1 до 59" >&2; exit 2; }
    [ -f "$DIR/.env" ] || { echo "Нет $DIR/.env — сначала подготовьте установку (deploy/README.md)" >&2; exit 1; }
    docker info >/dev/null 2>&1 || { echo "$(id -un) не может запускать docker — cron от него тоже не сможет" >&2; exit 1; }
    for tool in git curl jq flock; do
      command -v "$tool" >/dev/null || { echo "Нет $tool: sudo apt install $tool" >&2; exit 1; }
    done
    line="*/$every * * * * cd $DIR && bash deploy/update.sh --if-changed --wait-green >> $LOG 2>&1 $MARK"
    { current_crontab; echo "$line"; } | crontab -
    echo "Автомат включён: каждые $every мин проверяет master и выкладывает зелёные коммиты."
    echo "Журнал: $LOG"
    ;;
  remove)
    current_crontab | crontab -
    echo "Автомат выключен. Обновлять можно руками: bash deploy/update.sh"
    ;;
  status)
    if crontab -l 2>/dev/null | grep -qF "$MARK"; then
      echo "Автомат: включён — $(crontab -l | grep -F "$MARK" | awk '{print $1}')"
    else
      echo "Автомат: выключен (bash deploy/autoupdate.sh install)"
    fi
    port="$(grep -E '^HTTP_PORT=' "$DIR/.env" 2>/dev/null | cut -d= -f2 || true)"
    echo "Развёрнуто: $(curl -fsS --max-time 5 "http://127.0.0.1:${port:-80}/api/health" 2>/dev/null || echo 'health не ответил')"
    (cd "$DIR" && bash deploy/update.sh --check)
    if [ -s "$LOG" ]; then
      echo "Журнал ($LOG), последние записи:"
      tail -n 8 "$LOG"
    fi
    ;;
  *)
    sed -n '2,15p' "$0"
    exit 2
    ;;
esac
