v3 — доработанная версия. Работает без Docker и без MySQL: база — SQLite-файл `server/data.sqlite`, создаётся автоматически при старте.

Запуск:
  1. Установить Node.js (LTS)
  2. cd server && npm install
  3. node server.js
Приложение: http://localhost:3000

Учётные записи по умолчанию (создаются при старте сервера):
- admin / admin123 — администратор
- engineer / engineer123 — инженер
Регистрация новых пользователей — на /register.html, роль «user».

Роли:
- Пользователь — создаёт задачи.
- Инженер — выполняет назначенные задачи, может назначать исполнителя на свои.
- Администратор — видит все задачи (админка /admin.html), редактирует, переназначает, удаляет, выгружает CSV.

Реализовано:
- Роли и админка, удаление задач только админом
- Просмотр задач всех пользователей, переназначение исполнителя
- Календарь с дедлайнами задач
- История: фильтр «Выполненные», пагинация и выбор количества задач на странице
- Комментирование при завершении задачи
- Выгрузка в CSV (админка)
- API для Telegram-бота: /api/bot/link, /api/bot/tasks/:chatId, /api/bot/tasks/:id/complete
  (заголовок X-Bot-Key со значением BOT_API_KEY)

Переменные окружения: JWT_SECRET, BOT_API_KEY, NODE_ENV, MAX_BOT_TOKEN. БД: файл server/data.sqlite.

## Публикация на сервере (nginx/Apache + HTTPS)

1. Скопировать проект на сервер (например, /opt/mytasks), установить Node.js LTS.
2. `cd server && npm install`
3. Скопировать `.env.example` в `server/.env`, заполнить JWT_SECRET (и BOT_API_KEY).
   В production сервер слушает только 127.0.0.1:3000 — наружу его выпускает reverse-proxy.
4. Nginx: конфиг `deploy/nginx.conf` (заменив tasks.example.ru на свой домен).
   Apache: `deploy/apache.conf` (нужны модули proxy, proxy_http, ssl).
   Сертификаты: `certbot --nginx` / `certbot --apache` для своего домена.
5. Автозапуск: юнит `deploy/mytasks.service` в /etc/systemd/system,
   затем `systemctl daemon-reload && systemctl enable --now mytasks`.
6. Важно для вложений: лимит тела запроса на прокси — не меньше 16 МБ (в конфигах учтено).

Приложение отдаётся целиком с одного порта (статика + API), CORS-проблем за прокси нет.
Бот МАКС подключается позже: MAX_BOT_TOKEN в .env, публичный HTTPS-адрес уже будет готов.
