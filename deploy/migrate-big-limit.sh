#!/bin/bash
# Миграции Medusa открывают до ~500 соединений (у каждого модуля свой пул).
# Это разовый пик при первом развёртывании: даём Postgres запас, после миграции
# лимит снижается до рабочего значения.
set -u

pkill -f "medusa db:migrate" 2>/dev/null || true
sleep 3

cat > /tmp/pg-big.sql <<'SQL'
ALTER SYSTEM SET max_connections = 800;
ALTER SYSTEM SET work_mem = '2MB';
ALTER SYSTEM SET maintenance_work_mem = '48MB';
ALTER SYSTEM SET jit = off;
ALTER SYSTEM SET max_parallel_workers_per_gather = 0;
SQL
sudo -u postgres psql -q -f /tmp/pg-big.sql
systemctl restart postgresql
for i in $(seq 1 40); do sudo -u postgres psql -tAc "select 1;" >/dev/null 2>&1 && break; sleep 2; done
echo "лимит соединений: $(sudo -u postgres psql -tAc 'show max_connections;')"

rm -f /root/migrate.log /root/conns.log /root/mem.log
( while true; do
    s=$(sudo -u postgres psql -tAc "select count(*) from pg_stat_activity;" 2>/dev/null)
    m=$(free -m | awk '/Mem:/{print $7}')
    sw=$(free -m | awk '/Swap:/{print $3}')
    [ -n "$s" ] && echo "$(date +%H:%M:%S) соединений=$s доступно_МБ=$m swap_МБ=$sw" >> /root/conns.log
    sleep 5
  done ) & W=$!

cd /srv/narazborku/app/apps/backend/.medusa/server
sudo -u medusa npm run predeploy > /root/migrate.log 2>&1
EXIT=$?
kill $W 2>/dev/null
echo "MIGRATE_EXIT=$EXIT" >> /root/migrate.log

echo "код возврата: $EXIT"
echo "=== пик по соединениям и памяти ==="
sort -t= -k2 -n /root/conns.log | tail -3
echo "=== таблиц в базе ==="
sudo -u postgres psql -d narazborku_store -tAc "select count(*) from information_schema.tables where table_schema = current_schema();"
echo "=== хвост лога ==="
grep -v -E '^\{"level"|^\s+at ' /root/migrate.log | grep -v "^$" | tail -8
