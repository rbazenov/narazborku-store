#!/bin/bash
# Диагноз: на 1 ядре 150 параллельных SCRAM-аутентификаций не успевают обработаться —
# соединения зависают в состоянии "authentication", клиенты ретраят, лимит исчерпан.
# Решение: md5-аутентификация (значительно дешевле), запас соединений, затем миграции.
set -u

echo "=== 1. останавливаю все попытки миграции ==="
pkill -f "medusa db:migrate" 2>/dev/null
pkill -f "npm run predeploy" 2>/dev/null
pkill -f "run-migrate-watch" 2>/dev/null
pkill -f "final-migrate" 2>/dev/null
sleep 3

DBPASS=$(grep -oP '(?<=medusa:)[^@]+' /srv/narazborku/app/apps/backend/.env)

echo "=== 2. настройки PostgreSQL ==="
sudo -u postgres psql -q -c "ALTER SYSTEM SET max_connections = 300;"
sudo -u postgres psql -q -c "ALTER SYSTEM SET password_encryption = 'md5';"
sudo -u postgres psql -q -c "ALTER SYSTEM SET shared_buffers = '160MB';"
systemctl restart postgresql

for i in $(seq 1 40); do
  sudo -u postgres psql -tAc "select 1;" >/dev/null 2>&1 && break
  sleep 2
done

echo "=== 3. переустанавливаю пароль medusa в md5 ==="
sudo -u postgres psql -q -c "ALTER USER medusa WITH PASSWORD '$DBPASS';"
sudo -u postgres psql -tAc "show max_connections;"
sudo -u postgres psql -tAc "show password_encryption;"
echo "соединений сейчас: $(sudo -u postgres psql -tAc 'select count(*) from pg_stat_activity;')"

echo "=== 4. запускаю миграции (пул 1 на модуль) ==="
rm -f /root/migrate.log /root/conns.log
( while true; do
    n=$(sudo -u postgres psql -tAc "select count(*) from pg_stat_activity;" 2>/dev/null)
    [ -n "$n" ] && echo "$(date +%H:%M:%S) $n" >> /root/conns.log
    sleep 3
  done ) &
WATCH=$!

cd /srv/narazborku/app/apps/backend/.medusa/server
sudo -u medusa env DB_POOL_MIN=0 DB_POOL_MAX=1 \
  __MEDUSA_DB_CONNECTION_MAX_RETRIES=25 __MEDUSA_DB_CONNECTION_RETRY_DELAY=3000 \
  npm run predeploy > /root/migrate.log 2>&1
EXIT=$?
kill $WATCH 2>/dev/null
echo "MIGRATE_EXIT=$EXIT" >> /root/migrate.log

echo "код возврата: $EXIT"
echo "=== пик соединений ==="; sort -k2 -n /root/conns.log | tail -2
echo "=== таблиц в базе ==="
sudo -u postgres psql -d narazborku_store -tAc "select count(*) from information_schema.tables where table_schema = current_schema();"
echo "=== итоговые строки лога ==="
grep -v -E '^\{"level"|^\s+at ' /root/migrate.log | grep -v "^$" | tail -10
