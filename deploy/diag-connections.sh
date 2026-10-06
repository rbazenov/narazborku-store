#!/bin/bash
# Кто занимает соединения в PostgreSQL и почему «too many clients»
set -u

echo "=== служба магазина ==="
systemctl is-active narazborku 2>/dev/null || true
systemctl status narazborku --no-pager 2>/dev/null | head -12

echo "=== процессы node ==="
pgrep -af "medusa|node " | head -10 || echo "(нет)"

echo "=== настройки Postgres ==="
sudo -u postgres psql -tAc "show max_connections;"
sudo -u postgres psql -tAc "show superuser_reserved_connections;"
sudo -u postgres psql -tAc "show listen_addresses;"
sudo -u postgres psql -tAc "show port;"

echo "=== кластеры ==="
pg_lsclusters 2>/dev/null || echo "(нет pg_lsclusters)"

echo "=== соединения по приложениям ==="
sudo -u postgres psql -c "select coalesce(application_name,'(пусто)') as app, usename, state, count(*) from pg_stat_activity group by 1,2,3 order by 4 desc;" 2>&1 | head -20

echo "=== всего соединений ==="
sudo -u postgres psql -tAc "select count(*) from pg_stat_activity;"

echo "=== тест TCP-подключения под пользователем medusa ==="
PGPASSWORD="$(grep -oP '(?<=medusa:)[^@]+' /srv/narazborku/app/apps/backend/.env)" psql -h 127.0.0.1 -U medusa -d narazborku_store -tAc "select 'подключение ок', now();" 2>&1 | head -3

echo "=== файл .env (без пароля) ==="
sed -E 's#(://[^:]+:)[^@]+@#\1***@#' /srv/narazborku/app/apps/backend/.env
