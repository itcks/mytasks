#!/usr/bin/env bash
# Полная установка MyTasks в LXC-контейнере (Debian 12 / Ubuntu 24.04).
# Запуск: sudo bash install.sh [домен] [токен-бота-МАКС]
# Пример: sudo bash install.sh tasks.example.ru eyJhbGciOi...
# Если домен не указан — будет установлен без nginx, сервер на порту 3000.
set -euo pipefail

DOMAIN="${1:-}"
MAX_TOKEN="${2:-}"
APP_DIR="/opt/mytasks"
REPO="https://github.com/itcks/mytasks.git"

if [ "$EUID" -ne 0 ]; then
  echo "Запустите от root: sudo bash $0 $DOMAIN"
  exit 1
fi

echo "==> Проверка свободного места"
FREE_MB=$(df -Pm / | awk 'NR==2 {print $4}')
if [ "$FREE_MB" -lt 2000 ]; then
  echo "    ВНИМАНИЕ: на корневом разделе только ${FREE_MB} МБ свободно."
  echo "    Установка требует ~2 ГБ. Очистите место или увеличьте диск контейнера:"
  echo "      (на узле Proxmox)  pct resize <VMID> rootfs +6G"
  echo "      (в контейнере)     apt clean && journalctl --vacuum-size=50M"
  exit 1
fi

echo "==> Обновление системы и базовые пакеты"
apt update && apt full-upgrade -y
apt install -y curl git ca-certificates gnupg
apt clean
rm -rf /var/lib/apt/lists/*

echo "==> Node.js 22"
NODE_OK=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)
  if [ "$NODE_MAJOR" -ge 18 ]; then
    NODE_OK=1
    echo "    Найден подходящий Node.js $(node --version)"
  else
    echo "    Найден слишком старый Node.js $(node --version) — заменяю."
    apt purge -y nodejs libnode* nodejs-doc 2>/dev/null || true
  fi
fi

if [ "$NODE_OK" = "0" ]; then
  apt update
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt install -y nodejs
  apt clean
fi

# Жёсткая проверка: версия >= 18 и npm на месте
NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "    ОШИБКА: не удалось установить Node.js 18+ (сейчас: $(node --version 2>/dev/null || echo 'нет'))."
  echo "    Частая причина — не хватило места на диске. Проверьте: df -h /"
  exit 1
fi
apt install -y npm || true
node --version
npm --version

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

# ===== Подключение бота МАКС =====
if [ -z "$MAX_TOKEN" ] && [ -t 0 ]; then
  echo ""
  echo "Настройка бота МАКС (для уведомлений в мессенджер)."
  echo "Создайте бота через @MasterBot в МАКС и вставьте его токен."
  read -r -p "Токен бота МАКС (Enter — пропустить): " MAX_TOKEN || MAX_TOKEN=""
fi

if [ -n "$MAX_TOKEN" ]; then
  echo "==> Проверка токена бота МАКС"
  BOT_OK=$(curl -s "https://botapi.max.ru/me?access_token=$MAX_TOKEN" | head -c 200 || true)
  if echo "$BOT_OK" | grep -q '"ok":true'; then
    if grep -q '^MAX_BOT_TOKEN=' .env; then
      sed -i "s|^MAX_BOT_TOKEN=.*|MAX_BOT_TOKEN=$MAX_TOKEN|" .env
    else
      echo "MAX_BOT_TOKEN=$MAX_TOKEN" >> .env
    fi
    chmod 600 .env
    echo "    Токен сохранён, уведомления в МАКС включены."
    echo "    Пользователи привязывают чат боту в МАКС; без привязки уведомления"
    echo "    всё равно приходят в веб-интерфейс (колокольчик)."
  else
    echo "    ВНИМАНИЕ: Bot API не подтвердил токен. Ответ: $BOT_OK"
    echo "    Проверьте токен позже: nano $APP_DIR/server/.env"
  fi
else
  echo "    Токен бота МАКС не указан — уведомления работают в веб-интерфейсе."
  echo "    Подключить позже: sudo nano $APP_DIR/server/.env (MAX_BOT_TOKEN=...)"
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

  echo "==> Let's Encrypt: выпуск сертификата для $DOMAIN"
  apt install -y certbot python3-certbot-nginx

  # До 5 попыток с паузой 30 сек — DNS может расходиться не сразу
  CERT_OK=0
  for i in 1 2 3 4 5; do
    if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email; then
      CERT_OK=1
      break
    fi
    echo "    Попытка $i из 5 не удалась. Проверьте, что $DOMAIN уже указывает на этот сервер (порт 80 открыт)."
    if [ "$i" -lt 5 ]; then
      echo "    Повтор через 30 секунд..."
      sleep 30
    fi
  done

  if [ "$CERT_OK" = "1" ]; then
    echo "    Сертификат выпущен, HTTPS включён."
    # Автопродление: certbot сам ставит systemd-таймер; проверим
    if systemctl list-timers 2>/dev/null | grep -q certbot; then
      echo "    Автопродление сертификата включено (systemd-таймер certbot)."
    else
      systemctl enable --now certbot.timer 2>/dev/null || true
      echo "    Таймер автопродления: certbot.timer."
    fi
    # Быстрая проверка HTTPS
    sleep 1
    HTTPS_CODE=$(curl -sk "https://$DOMAIN" -o /dev/null -w '%{http_code}' || echo 000)
    if [ "$HTTPS_CODE" = "200" ]; then
      echo "    Проверка https://$DOMAIN — 200 OK"
    else
      echo "    ВНИМАНИЕ: https://$DOMAIN не ответил 200 (код $HTTPS_CODE). Проверьте nginx: nginx -t"
    fi
  else
    echo "    Сертификат не выпущен. Типичные причины:"
    echo "      - DNS ещё не обновился (A-запись $DOMAIN -> IP контейнера)"
    echo "      - порт 80 закрыт снаружи (нужен для подтверждения Let's Encrypt)"
    echo "    Повторить позже: sudo certbot --nginx -d $DOMAIN"
    echo "    Приложение продолжает работать по HTTP на порту 3000 и 80."
  fi
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
