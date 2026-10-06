#!/bin/bash
set -u
cat > /tmp/diag.sql <<'SQL'
select state, count(*) as cnt from pg_stat_activity group by state order by cnt desc;
SQL
cat > /tmp/diag2.sql <<'SQL'
select coalesce(application_name, '(empty)') as app, client_addr, count(*) as cnt
from pg_stat_activity group by 1, 2 order by cnt desc limit 6;
SQL

echo "=== состояния соединений ==="
sudo -u postgres psql -f /tmp/diag.sql
echo "=== приложение/адрес ==="
sudo -u postgres psql -f /tmp/diag2.sql
echo "=== процессы medusa/node ==="
ps -eo pid,etimes,rss,cmd | grep -E "medusa|node" | grep -v grep | head -6
echo "=== хвост лога миграции ==="
grep -v -E '^\{' /root/migrate.log | tail -12
echo "=== память ==="
free -m | head -3
echo "=== всего соединений ==="
sudo -u postgres psql -tAc "select count(*) from pg_stat_activity;"
