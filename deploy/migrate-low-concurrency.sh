#!/bin/bash
# Ключ к проблеме: medusa db:migrate по умолчанию запускает миграции ВСЕХ модулей
# параллельно (отсюда 500+ соединений и шторм на малом сервере).
# Ограничиваем параллельность одной-двумя миграциями.
set -u

pkill -9 -f "medusa db:migrate" 2>/dev/null || true
pkill -9 -f "npm run predeploy" 2>/dev/null || true
sleep 5

echo "=== возвращаю рабочий лимит соединений (300) ==="
sudo -u postgres psql -q -c "ALTER SYSTEM SET max_connections = 300;"
systemctl restart postgresql
for i in $(seq 1 40); do sudo -u postgres psql -tAc "select 1;" >/dev/null 2>&1 && break; sleep 2; done
echo "лимит: $(sudo -u postgres psql -tAc 'show max_connections;')"

rm -f /root/migrate.log /root/conns.log
( while true; do
    s=$(sudo -u postgres psql -tAc "select count(1) from pg_stat_activity;" 2>/dev/null)
    m=$(free -m | awk '/Mem:/{print $7}')
    [ -n "$s" ] && echo "$(date +%H:%M:%S) соединений=$s доступно_МБ=$m" >> /root/conns.log
    sleep 5
  done ) & W=$!

cd /srv/narazborku/app/apps/backend/.medusa/server
sudo -u medusa ./node_modules/.bin/medusa db:migrate --concurrency 2 > /root/migrate.log 2>&1
EXIT=$?
kill $W 2>/dev/null
echo "MIGRATE_EXIT=$EXIT" >> /root/migrate.log

echo "код возврата: $EXIT"
echo "=== пик по соединениям ==="
sort -t= -k2 -n /root/conns.log | tail -3
echo "=== таблиц в базе ==="
sudo -u postgres psql -d narazborku_store -tAc "select count(1) from information_schema.tables where table_schema = current_schema();"
echo "=== лог ==="
grep -v -E '^\{"level"|^\s+at ' /root/migrate.log | grep -v "^$" | tail -12
