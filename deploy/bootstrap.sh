#!/usr/bin/env bash
# Подготовка чистой Ubuntu-машины под НТТ Калькулятор (РАЗВЁРТЫВАНИЕ.md, часть 2).
#
# Делает то же, что шаги 2.0–2.4 руководства, но одной командой и повторяемо:
# пользователь deploy, файрвол, swap, клон репозитория и `.env` со сгенерированными
# секретами. Уже сделанное не переделывает — скрипт можно запускать снова.
#
# Запуск от root на машине (Ubuntu 22.04/24.04):
#
#   curl -fsSL https://raw.githubusercontent.com/BaukovGK/CalcKP/master/deploy/bootstrap.sh -o bootstrap.sh
#   less bootstrap.sh          # прочитать перед запуском — он правит систему
#   bash bootstrap.sh
#
# Ключи:
#   --dir PATH         куда клонировать (по умолчанию /opt/CalcKP)
#   --user NAME        пользователь деплоя (по умолчанию deploy)
#   --url URL          внешний адрес приложения (по умолчанию http://<IP машины>)
#   --token TOKEN      токен GitHub на чтение (нужен, только если репозиторий закроют)
#   --install-docker   поставить Docker официальным скриптом get.docker.com
#   --skip-firewall    не трогать ufw
#   --skip-swap        не создавать swap-файл
#
# Docker по умолчанию НЕ ставится: установка чужим скриптом из сети — решение
# администратора, а не этого файла. Нет Docker — скрипт скажет, какой командой
# его поставить, и остановится.
set -euo pipefail

REPO_URL_BASE="github.com/BaukovGK/CalcKP.git"
DIR=/opt/CalcKP
USER_NAME=deploy
PUBLIC_URL=""
TOKEN=""
INSTALL_DOCKER=0
SKIP_FIREWALL=0
SKIP_SWAP=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --user) USER_NAME="$2"; shift 2 ;;
    --url) PUBLIC_URL="$2"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    --install-docker) INSTALL_DOCKER=1; shift ;;
    --skip-firewall) SKIP_FIREWALL=1; shift ;;
    --skip-swap) SKIP_SWAP=1; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "Неизвестный ключ: $1" >&2; exit 2 ;;
  esac
done

say() { echo; echo "== $* =="; }
skip() { echo "   уже сделано: $*"; }

[ "$(id -u)" = 0 ] || { echo "Запускать от root: sudo bash $0" >&2; exit 1; }
command -v apt-get >/dev/null || { echo "Скрипт рассчитан на Ubuntu/Debian" >&2; exit 1; }

# ── 1. Пользователь деплоя ───────────────────────────────────────────────────
say "Пользователь $USER_NAME"
if id "$USER_NAME" >/dev/null 2>&1; then
  skip "пользователь $USER_NAME есть"
else
  adduser --disabled-password --gecos "" "$USER_NAME"
  usermod -aG sudo "$USER_NAME"
  echo "   создан, добавлен в sudo"
fi
# Доступ тем же ключом, которым вошли на машину: иначе войти под deploy нечем.
if [ -f /root/.ssh/authorized_keys ] && [ ! -s "/home/$USER_NAME/.ssh/authorized_keys" ]; then
  install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" "/home/$USER_NAME/.ssh"
  install -m 600 -o "$USER_NAME" -g "$USER_NAME" /root/.ssh/authorized_keys "/home/$USER_NAME/.ssh/authorized_keys"
  echo "   ключи root скопированы — под $USER_NAME можно войти тем же ключом"
fi

# ── 2. Docker ────────────────────────────────────────────────────────────────
say "Docker"
if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
  skip "$(docker --version), $(docker compose version)"
elif [ "$INSTALL_DOCKER" = 1 ]; then
  curl -fsSL https://get.docker.com | sh
  echo "   поставлен"
else
  cat >&2 <<TXT
   Docker не найден. Поставьте его и запустите скрипт снова:
       curl -fsSL https://get.docker.com | sh
   либо перезапустите этот скрипт с ключом --install-docker.
TXT
  exit 1
fi
# Группы docker может не быть (Docker поставлен иначе — rootless, snap, podman):
# это не повод обрывать подготовку.
if getent group docker >/dev/null; then
  usermod -aG docker "$USER_NAME"
  echo "   $USER_NAME добавлен в группу docker"
else
  echo "   группы docker нет — проверьте, что $USER_NAME может запускать docker" >&2
fi

# ── 3. Файрвол ───────────────────────────────────────────────────────────────
if [ "$SKIP_FIREWALL" = 0 ]; then
  say "Файрвол: SSH, HTTP, HTTPS"
  if command -v ufw >/dev/null || apt-get install -y ufw >/dev/null 2>&1; then
    ufw allow OpenSSH >/dev/null
    ufw allow 80/tcp >/dev/null
    ufw allow 443/tcp >/dev/null
    ufw --force enable >/dev/null
    echo "   открыты 22, 80, 443"
  else
    echo "   ufw поставить не удалось — откройте 22, 80 и 443 средствами площадки" >&2
  fi
fi

# ── 4. Swap ──────────────────────────────────────────────────────────────────
# Сборка фронта на машине с 1–2 ГБ памяти без swap падает по OOM.
if [ "$SKIP_SWAP" = 0 ]; then
  say "Swap"
  if [ "$(swapon --show --noheadings | wc -l)" -gt 0 ]; then
    skip "swap уже подключён"
  else
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo "   добавлено 2 ГБ"
  fi
fi

# ── 5. Репозиторий ───────────────────────────────────────────────────────────
say "Репозиторий в $DIR"
REPO_URL="https://$REPO_URL_BASE"
[ -n "$TOKEN" ] && REPO_URL="https://$TOKEN@$REPO_URL_BASE"
if [ -d "$DIR/.git" ]; then
  skip "клон есть"
  sudo -u "$USER_NAME" git -C "$DIR" fetch --all --quiet || true
else
  install -d -o "$USER_NAME" -g "$USER_NAME" "$(dirname "$DIR")"
  sudo -u "$USER_NAME" git clone --quiet "$REPO_URL" "$DIR"
  echo "   склонирован"
fi
# В .git/config попадает токен, если он был.
chmod 600 "$DIR/.git/config"
chown -R "$USER_NAME:$USER_NAME" "$DIR"

# ── 6. .env ──────────────────────────────────────────────────────────────────
say "Файл .env"
ENV_FILE="$DIR/.env"
if [ -f "$ENV_FILE" ]; then
  skip ".env есть — секреты не трогаю"
else
  # Пароли идут в строку подключения, поэтому шестнадцатеричные: в URL они
  # безопасны без экранирования. JWT-секрет в URL не попадает.
  rand_hex() { openssl rand -hex 24; }
  [ -n "$PUBLIC_URL" ] || PUBLIC_URL="http://$(hostname -I | awk '{print $1}')"

  cp "$DIR/.env.example" "$ENV_FILE"
  set_env() {
    if grep -q "^$1=" "$ENV_FILE"; then
      # Значение подставляем через awk: в пароле бывают символы, которые sed
      # принял бы за часть выражения.
      awk -v k="$1" -v v="$2" -F= 'BEGIN{OFS="="} $1==k {print k, v; next} {print}' "$ENV_FILE" > "$ENV_FILE.tmp"
      mv "$ENV_FILE.tmp" "$ENV_FILE"
    else
      echo "$1=$2" >> "$ENV_FILE"
    fi
  }
  set_env POSTGRES_PASSWORD "$(rand_hex)"
  set_env JWT_SECRET "$(openssl rand -base64 48 | tr -d '\n')"
  # Роль приложения без прав суперпользователя (План_устранения 2.6): на новой
  # установке база заведёт её сама.
  set_env APP_DB_USER ntt_app
  set_env APP_DB_PASSWORD "$(rand_hex)"
  set_env PUBLIC_URL "$PUBLIC_URL"
  # Пароль первого администратора остаётся пустым: сид сгенерирует случайный и
  # один раз напечатает его в лог — в файле он не лежит.
  set_env ADMIN_INITIAL_PASSWORD ""
  chmod 600 "$ENV_FILE"
  chown "$USER_NAME:$USER_NAME" "$ENV_FILE"
  echo "   создан, секреты сгенерированы, PUBLIC_URL=$PUBLIC_URL"
fi

cat <<TXT

Готово. Дальше:

  1. Проверить готовность:      sudo -u $USER_NAME bash $DIR/deploy/preflight.sh
  2. Поднять стек:              cd $DIR && sudo -u $USER_NAME docker compose up -d --build
     Пароль администратора:     sudo -u $USER_NAME docker compose -f $DIR/docker-compose.yml logs backend | grep "пароль первого администратора"
  3. Ключ для GitHub Actions:   sudo -u $USER_NAME bash $DIR/deploy/actions-key.sh
     и завести секреты репозитория — их перечислит сам скрипт.

Проверить PUBLIC_URL в $DIR/.env: там должен быть адрес, по которому машина
видна снаружи (сейчас взят первый адрес интерфейса).
TXT
