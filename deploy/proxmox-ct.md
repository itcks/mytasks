# Создание и запуск LXC-контейнера на Proxmox + установка MyTasks

## Шаг 1. Скачать шаблон контейнера

В веб-интерфейсе Proxmox:

1. Выбрать узел (например, `pve`) → **local** (хранилище) → **Шаблоны** → **Шаблоны**.
2. В списке выбрать `debian-12-standard_12.7-1_amd64.tar.zst` (или новее) → **Скачать**.

Или через SSH на узле Proxmox:

```bash
pveam update
pveam available | grep debian-12
pveam download local debian-12-standard_12.7-1_amd64.tar.zst
```

## Шаг 2. Создать контейнер

Веб-интерфейс: **Создать CT** (кнопка сверху).

| Параметр | Значение |
|---|---|
| Имя хоста | `mytasks` |
| Пароль root | ваш пароль |
| Непривилегированный контейнер | да |
| Шаблон | debian-12-standard… |
| Хранилище диска | local-lvm, 8 ГБ |
| Ядра | 1–2 |
| Память | 1024–2048 МБ |
| Сеть | DHCP или статический IP |
| DNS | как у узла |
| Запуск после создания | отметить галкой |

Или через SSH на узле Proxmox (замените 103 на свободный VMID):

```bash
pct create 103 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
  --hostname mytasks --password 'ВАШ_ПАРОЛЬ' \
  --cores 2 --memory 2048 --swap 512 \
  --rootfs local-lvm:8 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --unprivileged 1 --features nesting=0 \
  --onboot 1 --start 1
```

## Шаг 3. Войти в контейнер и запустить установку

```bash
# с узла Proxmox:
pct enter 103
# или SSH по IP контейнера
```

Внутри контейнера — одна команда:

```bash
curl -fsSL https://raw.githubusercontent.com/itcks/mytasks/main/deploy/install.sh -o install.sh
sudo bash install.sh ваш-домен.ru
```

Скрипт сам: обновит систему, поставит Node.js 22 и nginx, склонирует репозиторий,
создаст `.env` со случайными секретами, зарегистрирует systemd-сервис,
настроит nginx и выпустит сертификат Let's Encrypt (если указан домен).

Требования к домену: A-запись домена указывает на IP контейнера,
порты 80 и 443 проброшены с роутера на IP контейнера.

Без домена (внутреннее использование):

```bash
sudo bash install.sh
# приложение будет доступно по http://IP-контейнера:3000
```

## Шаг 4. Проверка

- Откройте `https://ваш-домен.ru` (или `http://IP:3000`).
- Вход: `admin / admin123` — сразу смените пароль.
- Создайте пользователя-инженера в админке.

## Шаг 5. Обслуживание

```bash
# Обновление приложения
cd /opt/mytasks && git pull && systemctl restart mytasks

# Бэкап базы (перед git pull)
cp /opt/mytasks/server/data.sqlite /root/backup-$(date +%F).sqlite

# Логи
journalctl -u mytasks -f
```

Бэкап контейнера целиком — штатными средствами Proxmox:
узел → **Backup** → задание по расписанию (в бэкап попадёт и база).

## Управление сервисом

```bash
systemctl status mytasks    # состояние
systemctl restart mytasks   # перезапуск
systemctl stop mytasks      # остановка
```
