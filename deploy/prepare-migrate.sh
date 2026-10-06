#!/bin/bash
# Подготовка к миграциям: останавливаем циклично перезапускающуюся службу,
# освобождаем подключения, временно поднимаем лимит соединений Postgres.
set -u

echo "=== 1. останавливаю службу магазина ==="
systemctl stop narazborku 2>/dev/null || true
sleep 2
pkill -f "medusa db:migrate" 2>/dev/null || true
pkill -f "npm run predeploy" 2>/dev/null || true
pkill -f "medusa start" 2>/dev/null || true
sleep 3

echo "=== 2. соединения до очистки ==="
sudo -u postgres psql -tAc "select count(*) from pg_stat_activity;" 2>&1 | head -1

echo "=== 3. временно поднимаю лимит до 250 ==="
sudo -u postgres psql -q -c "ALTER SYSTEM SET max_connections = 250;"
systemctl restart postgresql
sleep 5
sudo -u postgres psql -tAc "show max_connections;"
echo "=== 4. процессы node после очистки ==="
pgrep -af "medusa|npm run" | head -5 || echo "(нет)"
