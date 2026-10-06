#!/bin/bash
# Запуск миграций с наблюдением за числом соединений
set -u

rm -f /root/migrate.log /root/conns.log
# мягкие ретраи подключения (на медленном сервере старт PG бывает небыстрым)
export __MEDUSA_DB_CONNECTION_MAX_RETRIES=20
export __MEDUSA_DB_CONNECTION_RETRY_DELAY=2000

( while true; do
    n=$(sudo -u postgres psql -tAc "select count(*) from pg_stat_activity;" 2>/dev/null)
    echo "$(date +%H:%M:%S) $n" >> /root/conns.log
    sleep 3
  done ) &
WATCHER=$!

cd /srv/narazborku/app/apps/backend/.medusa/server
sudo -u medusa env __MEDUSA_DB_CONNECTION_MAX_RETRIES=20 __MEDUSA_DB_CONNECTION_RETRY_DELAY=2000 \
  npm run predeploy > /root/migrate.log 2>&1
EXIT=$?
echo "MIGRATE_EXIT=$EXIT" >> /root/migrate.log
kill $WATCHER 2>/dev/null

echo "код возврата: $EXIT"
echo "=== пик соединений ==="
sort -k2 -n /root/conns.log | tail -3
echo "=== таблиц в базе ==="
sudo -u postgres psql -d narazborku_store -tAc "select count(*) from information_schema.tables where table_schema = current_schema();"
echo "=== ключевые строки лога ==="
grep -v -E '^\{"level"|^\s+at ' /root/migrate.log | grep -v "^$" | tail -12
