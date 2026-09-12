#!/usr/bin/env bash
# Ключ «GitHub Actions → сервер» и список секретов репозитория
# (РАЗВЁРТЫВАНИЕ.md, часть 3).
#
# Запускать НА СЕРВЕРЕ под пользователем деплоя:
#
#   bash deploy/actions-key.sh
#
# Скрипт создаёт отдельный ключ только для выкладки, разрешает его этому
# пользователю и печатает закрытую часть ОДИН раз — её нужно скопировать в
# секрет репозитория. Отдельный ключ нужен затем, чтобы отозвать доступ
# Actions, не трогая ваши личные ключи: достаточно убрать одну строку из
# authorized_keys.
set -euo pipefail

KEY="$HOME/.ssh/github-actions-deploy"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

install -d -m 700 "$HOME/.ssh"

if [ -f "$KEY" ]; then
  echo "Ключ уже есть: $KEY"
  echo "Закрытую часть скрипт повторно не печатает: если она потеряна, удалите"
  echo "пару ($KEY, $KEY.pub), уберите её строку из ~/.ssh/authorized_keys и"
  echo "запустите скрипт снова."
  PRINT_PRIVATE=0
else
  ssh-keygen -t ed25519 -N '' -C "github-actions-deploy" -f "$KEY" >/dev/null
  PRINT_PRIVATE=1
  echo "Создан ключ $KEY"
fi

# Разрешаем ровно этот ключ и ровно один раз.
touch "$HOME/.ssh/authorized_keys"
chmod 600 "$HOME/.ssh/authorized_keys"
if grep -qxF "$(cat "$KEY.pub")" "$HOME/.ssh/authorized_keys"; then
  echo "Открытая часть уже разрешена в ~/.ssh/authorized_keys"
else
  cat "$KEY.pub" >> "$HOME/.ssh/authorized_keys"
  echo "Открытая часть добавлена в ~/.ssh/authorized_keys"
fi

IP="$(curl -fsS --max-time 5 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"

cat <<TXT

── Секреты репозитория ──────────────────────────────────────────────────────
GitHub → Settings → Secrets and variables → Actions → New repository secret

  DEPLOY_SSH_HOST   $IP
  DEPLOY_SSH_USER   $(id -un)
  DEPLOY_PATH       $REPO_DIR
  DEPLOY_SSH_PORT   (только если SSH не на 22)
TXT

if [ "$PRINT_PRIVATE" = 1 ]; then
  cat <<'TXT'
  DEPLOY_SSH_KEY    закрытая часть — весь блок ниже, вместе со строками
                    BEGIN/END, без лишних пробелов
TXT
  echo
  cat "$KEY"
  echo
  echo "Скопируйте блок выше в секрет и очистите историю терминала, если она хранится."
fi

cat <<TXT

Проверка со стороны GitHub: сделайте пустой коммит в главную ветку
(git commit --allow-empty -m "проверка деплоя" && git push) и посмотрите
задачу «Деплой на сервер (SSH)» в Actions. Пока секретов нет, она
пропускается — красным прогон от этого не станет.
TXT
