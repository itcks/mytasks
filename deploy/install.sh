#!/usr/bin/env bash
# Полная установка MyTasks в LXC-контейнере (Debian 12 / Ubuntu 24.04).
# Запуск: sudo bash install.sh [домен]
# Пример: sudo bash install.sh tasks.example.ru
# Если домен не указан — будет установлен без nginx, сервер на порту 3000.
set -euo pipefail

DOMAIN="${1:-}"
APP_DIR="/opt/mytasks"
REPO="https://github.com/itcks/mytasks.git"

if [ "$EUID" -ne 0 ]; then
  echo "Запустите от root: sudo bash $0 $DOMAIN"
  exit 1
fi

echo "==> Обновление системы и базовые пакеты"
apt update && apt full-upgrade -y
apt install -y curl git ca-certificates gnupg

echo "==> Node.js 22"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt install -y nodejs
fi
node --version

echo "==> Клонирование приложения в $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR" && git pull
else
  rm -rf "$APP_DIR"
  git clone "$REPO" "$APP_DIR"
fi

cd "$APP_DIR/server"

echo "==> Зависимости и .env"
npm install --omit=dev
if [ ! -f .env ]; then
  JWT=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  BOT=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
  {
    echo "JWT_SECRET=$JWT"
    echo "BOT_API_KEY=$BOT"
    echo "NODE_ENV=production"
    echo "MAX_BOT_TOKEN="
  } > .env
  chmod 600 .env
  echo "    .env создан со случайными секретами."
else
  echo "    .env уже существует — не трогаю."
fi

echo "==> systemd-сервис mytasks"
cp "$APP_DIR/deploy/mytasks.service" /etc/systemd/system/mytasks.service
sed -i 's|^User=.*|User=root|; s|^WorkingDirectory=.*|WorkingDirectory='"$APP_DIR"'/server|' \
  /etc/systemd/system/mytasks.service
systemctl daemon-reload
systemctl enable --now mytasks
sleep 2
systemctl status mytasks --no-pager | head -5 || true

echo "==> Проверка сервера"
CODE=$(curl -s http://127.0.0.1:3000 -o /dev/null -w '%{http_code}')
if [ "$CODE" = "200" ]; then
  echo "    Сервер отвечает: 200 OK"
else
  echo "    ВНИМАНИЕ: сервер не ответил 200 (код $CODE), смотрите journalctl -u mytasks"
fi

# ===== nginx + HTTPS (только если передан домен) =====
if [ -n "$DOMAIN" ]; then
  echo "==> nginx для $DOMAIN"
  apt install -y nginx
  cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/mytasks
  sed -i "s|tasks.example.ru|$DOMAIN|g; s|/etc/letsencrypt/live/tasks.example.ru/|/etc/letsencrypt/live/$DOMAIN/|g" \
    /etc/nginx/sites-available/mytasks

  # До выпуска сертификата: HTTP-only заглушка, чтобы certbot мог подтвердить домен
  cat > /etc/nginx/sites-available/mytasks <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    client_max_body_size 16m;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

  ln -sf /etc/nginx/sites-available/mytasks /etc/nginx/sites-enabled/mytasks
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx

  echo "==> Let's Encrypt"
  apt install -y certbot python3-certbot-nginx
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email \
    || echo "    Не удалось выпустить сертификат. Проверьте DNS: $DOMAIN должен указывать на этот сервер, порт 80 открыт. Повторите позже: certbot --nginx -d $DOMAIN"
else
  echo "==> Домен не указан — nginx не устанавливается."
  echo "    Приложение доступно на порту 3000. Для HTTPS запустите позже:"
  echo "    sudo bash $0 ваш-домен"
fi

echo ""
echo "Готово."
echo "Вход: admin / admin123 (смените пароль!), engineer / engineer123."
echo "Обновление приложения: cd $APP_DIR && git pull && systemctl restart mytasks"
echo "База данных: $APP_DIR/server/data.sqlite — делайте её копию перед git pull."
