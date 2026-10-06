#!/bin/bash
set -u
echo "=== процессы, которые держат соединения к PostgreSQL ==="
ss -tnp 2>/dev/null | grep -E ":5432|:5432 " | awk '{print $NF}' | grep -oP 'pid=\K[0-9]+' | sort | uniq -c | sort -rn | head -10

echo "=== список node-процессов медины ==="
ps -eo pid,ppid,etimes,rss,stat,cmd | grep -E "medusa|node" | grep -v grep | head -12

echo "=== сколько всего соединений и в каком состоянии ==="
sudo -u postgres psql -tAc "select state, count(*) from pg_stat_activity group by state order by 2 desc;" 2>/dev/null

echo "=== сводка fd у процессов ==="
for pid in $(pgrep -f "medusa db:migrate" | head -3); do
  echo "pid $pid: открытых файлов $(ls /proc/$pid/fd 2>/dev/null | wc -l), лимит $(grep -m1 'Max open files' /proc/$pid/limits 2>/dev/null | awk '{print $4}')"
done
