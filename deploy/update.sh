#!/usr/bin/env bash
# Обновление MyTasks без потери данных.
# Использование: sudo bash update.sh
# База данных (server/data.sqlite) и .env в git не входят и не перезаписываются.
# Перед каждым обновлением скрипт делает бэкап базы и .env в /var/backups/mytasks.
set -euo pipefail

APP_DIR="/opt/mytasks"
BACKUP_DIR="/var/backups/mytasks"
SERVICE="mytasks"

if [ "$EUID" -ne 0 ]; then
  echo "Запустите от root: sudo bash $0"
  exit 1
fi

cd "$APP_DIR"

if [ ! -f server/data.sqlite ]; then
  echo "ВНИМАНИЕ: $APP_DIR/server/data.sqlite не найден — возможно, приложение ещё не запускалось."
fi

echo "==> Остановка сервиса"
systemctl stop "$SERVICE" || true

echo "==> Бэкап базы и конфигурации"
mkdir -p "$BACKUP_DIR"
STAMP=$(date +%F_%H%M)
if [ -f server/data.sqlite ]; then
  cp server/data.sqlite "$BACKUP_DIR/data-$STAMP.sqlite"
  # WAL/SHM, если процесс не успел их закрыть
  [ -f server/data.sqlite-wal ] && cp server/data.sqlite-wal "$BACKUP_DIR/data-$STAMP.sqlite-wal" 2>/dev/null || true
  [ -f server/data.sqlite-shm ] && cp server/data.sqlite-shm "$BACKUP_DIR/data-$STAMP.sqlite-shm" 2>/dev/null || true
  echo "    База: $BACKUP_DIR/data-$STAMP.sqlite"
fi
if [ -f server/.env ]; then
  cp server/.env "$BACKUP_DIR/env-$STAMP"
  chmod 600 "$BACKUP_DIR/env-$STAMP"
  echo "    Конфиг: $BACKUP_DIR/env-$STAMP"
fi

echo "==> Загрузка обновлений"
git pull --ff-only

echo "==> Зависимости"
cd server
npm install --omit=dev

echo "==> Запуск сервиса"
systemctl start "$SERVICE"
sleep 2

CODE=$(curl -s http://127.0.0.1:3000 -o /dev/null -w '%{http_code}' || echo 000)
if [ "$CODE" = "200" ]; then
  echo "==> Обновление завершено. Приложение работает: 200 OK"
  # Оставляем последние 30 бэкапов
  ls -1t "$BACKUP_DIR"/data-*.sqlite 2>/dev/null | tail -n +31 | xargs -r rm -f
  echo "    Последние 30 бэкапов базы хранятся в $BACKUP_DIR"
else
  echo "==> ВНИМАНИЕ: сервер не ответил 200 (код $CODE)."
  echo "    Логи: journalctl -u $SERVICE -n 50"
  echo "    Откат обновления: cd $APP_DIR && git log --oneline -3 && git checkout <commit> && systemctl restart $SERVICE"
  echo "    Восстановление базы: systemctl stop $SERVICE && cp $BACKUP_DIR/data-$STAMP.sqlite $APP_DIR/server/data.sqlite && systemctl start $SERVICE"
fi
