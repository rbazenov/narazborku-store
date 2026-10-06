#!/bin/bash
# Поиск процесса, который держит соединения PostgreSQL
set -u

echo "=== соединения: кто и откуда ==="
sudo -u postgres psql -h /var/run/postgresql -tAc "
select coalesce(application_name,'(пусто)')||' | '||coalesce(usename,'?')||' | '||
       coalesce(client_addr::text,'local')||' | '||coalesce(state,'?')||' | '||count(*)
from pg_stat_activity group by 1,2,3,4 order by count(*) desc limit 12;" 2>&1 | head -15

echo "=== всего соединений ==="
sudo -u postgres psql -h /var/run/postgresql -tAc "select count(*) from pg_stat_activity;" 2>&1 | head -2

echo "=== процессы node/medusa на сервере ==="
ps -eo pid,ppid,etimes,rss,cmd | grep -E "medusa|node" | grep -v grep | head -15

echo "=== служба ==="
systemctl is-active narazborku 2>/dev/null; systemctl is-active postgresql

echo "=== лимит ==="
sudo -u postgres psql -h /var/run/postgresql -tAc "show max_connections;" 2>&1 | head -1
