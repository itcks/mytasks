# Развёртывание MyTasks в LXC-контейнере Proxmox

## 1. Создание контейнера

- Тип: LXC (unprivileged), шаблон Debian 12 или Ubuntu 24.04.
- Ресурсы: 1–2 ядра, 1–2 ГБ RAM, 4–8 ГБ диска — с запасом.
- Сеть: DHCP или статический IP в локальной сети; хостнейм, например, `mytasks`.
- В пункте «Без привилегий» — да; вложения не нужны.

## 2. Базовая настройка внутри контейнера

```bash
apt update && apt full-upgrade -y
apt install -y curl git nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
```

## 3. Установка приложения

```bash
mkdir -p /opt/mytasks && cd /opt/mytasks
git clone https://github.com/itcks/mytasks.git .
cd server
npm install
cp .env.example .env
# Заполните JWT_SECRET (команда генерации есть в .env.example) и BOT_API_KEY:
nano .env
```

## 4. Автозапуск (systemd)

```bash
cp /opt/mytasks/deploy/mytasks.service /etc/systemd/system/mytasks.service
# В юните поменять User=www-data на вашего пользователя и WorkingDirectory=/opt/mytasks/server
nano /etc/systemd/system/mytasks.service
systemctl daemon-reload
systemctl enable --now mytasks
systemctl status mytasks   # должно быть active
curl -s http://127.0.0.1:3000 -o /dev/null -w '%{http_code}\n'   # 200
```

## 5. Nginx + HTTPS (Let's Encrypt)

```bash
cp /opt/mytasks/deploy/nginx.conf /etc/nginx/sites-available/mytasks
nano /etc/nginx/sites-available/mytasks   # tasks.example.ru -> ваш домен
ln -s /etc/nginx/sites-available/mytasks /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
apt install -y certbot python3-certbot-nginx
certbot --nginx -d tasks.example.ru       # выпустит сертификат и перепишет конфиг
```

Требование: домен должен указывать на IP контейнера, а порты 80/443 — быть доступны
извне (проброс портов на роутере или отдельный интерфейс). В LXC просто откройте
порты в фаерволе узла/контейнера, NAT Proxmox настраивать не обязательно.

## 6. Проверка

- `https://ваш-домен` — страница входа, admin/admin123 (смените пароль).
- Загрузка вложения до 10 МБ — лимиты 16 МБ уже прописаны в конфигах.
- Обновления приложения: `cd /opt/mytasks && git pull && systemctl restart mytasks`.

## 7. Для бота МАКС (позже)

Публичный HTTPS уже готов. Дальше:
1. В `.env` вписать MAX_BOT_TOKEN (токен из @MasterBot), `systemctl restart mytasks`.
2. Пользователи привязывают чат боту — уведомления о назначении, статусах,
   напоминания и просрочки начнут приходить в МАКС.
