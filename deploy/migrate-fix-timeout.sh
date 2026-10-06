#!/bin/bash
# Клиент (Node на 1 ядре) открывает ~300 сокетов, но не успевает отправить приветствие,
# и PostgreSQL разрывает соединения по authentication_timeout (60 с). Увеличиваем таймаут
# и лимиты файловых дескрипторов, чтобы «шторм» успел устояться.
set -u

pkill -f "medusa db:migrate" 2>/dev/null || true
pkill -f "npm run predeploy" 2>/dev/null || true
pkill -f "run-migrate-watch" 2>/dev/null || true
sleep 4

cat > /tmp/pg-auth.sql <<'SQL'
ALTER SYSTEM SET authentication_timeout = 600;
ALTER SYSTEM SET max_connections = 500;
SQL
sudo -u postgres psql -q -f /tmp/pg-auth.sql
systemctl restart postgresql
for i in $(seq 1 40); do
  sudo -u postgres psql -tAc "select 1;" >/dev/null 2>&1 && break
  sleep 2
done
echo "authentication_timeout: $(sudo -u postgres psql -tAc 'show authentication_timeout;')"
echo "max_connections: $(sudo -u postgres psql -tAc 'show max_connections;')"

# лимиты дескрипторов для процесса миграции и для сервиса
grep -q "no limit" /etc/security/limits.conf || cat >> /etc/security/limits.conf <<'EOF'
medusa soft nofile 65535
medusa hard nofile 65535
root soft nofile 65535
root hard nofile 65535
EOF

rm -f /root/migrate.log /root/conns.log
( while true; do
    s=$(sudo -u postgres psql -tAc "select count(*) filter (where state='starting')||'/'||count(*) from pg_stat_activity;" 2>/dev/null)
    [ -n "$s" ] && echo "$(date +%H:%M:%S) $s" >> /root/conns.log
    sleep 5
  done ) &
WATCH=$!

cd /srv/narazborku/app/apps/backend/.medusa/server
ulimit -n 65535
sudo -u medusa bash -c 'ulimit -n 65535; cd /srv/narazborku/app/apps/backend/.medusa/server && npm run predeploy' > /root/migrate.log 2>&1
EXIT=$?
kill $WATCH 2>/dev/null
echo "MIGRATE_EXIT=$EXIT" >> /root/migrate.log

echo "код возврата: $EXIT"
echo "=== динамика (starting/всего) ==="; tail -6 /root/conns.log
echo "=== таблиц в базе ==="
sudo -u postgres psql -d narazborku_store -tAc "select count(*) from information_schema.tables where table_schema = current_schema();"
echo "=== итог лога ==="
grep -v -E '^\{"level"|^\s+at ' /root/migrate.log | grep -v "^$" | tail -10
