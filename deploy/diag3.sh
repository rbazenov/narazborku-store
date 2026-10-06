#!/bin/bash
set -u
cat > /tmp/q1.sql <<'SQL'
select state, wait_event_type, wait_event, count(*) as cnt, max(now() - backend_start) as max_age
from pg_stat_activity
group by 1, 2, 3 order by cnt desc limit 10;
SQL
cat > /tmp/q2.sql <<'SQL'
select count(*) as total, count(*) filter (where state = 'starting') as starting,
       count(*) filter (where state = 'authentication') as authenticating
from pg_stat_activity;
SQL

echo "=== соединения по состояниям и ожиданиям ==="
sudo -u postgres psql -f /tmp/q1.sql
echo "=== сводка ==="
sudo -u postgres psql -f /tmp/q2.sql
echo "=== нагрузка ==="
uptime
echo "=== swap ==="
free -m | tail -2
echo "=== лог PostgreSQL (последние 20 строк) ==="
tail -20 /var/log/postgresql/postgresql-18-main.log | cut -c1-190
echo "=== количество процессов postgres ==="
pgrep -c postgres
