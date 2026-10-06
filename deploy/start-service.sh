#!/bin/bash
# Запуск магазина и проверка работоспособности
set -u

echo "=== запускаю службу ==="
systemctl restart narazborku
for i in $(seq 1 30); do
  systemctl is-active --quiet narazborku && break
  sleep 3
done
echo "статус: $(systemctl is-active narazborku)"

echo "=== жду ответа приложения ==="
OK=0
for i in $(seq 1 40); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:9000/health 2>/dev/null)
  if [ "$CODE" = "200" ]; then OK=1; break; fi
  sleep 5
done
echo "health: $CODE (после ${i} попыток)"

echo "=== соединения и память ==="
sudo -u postgres psql -tAc "select count(1) from pg_stat_activity;"
free -m | head -2

echo "=== проверки API ==="
curl -s -o /dev/null -w "  /health    → %{http_code}\n" --max-time 10 http://127.0.0.1:9000/health
curl -s -o /dev/null -w "  /app       → %{http_code}\n" --max-time 20 http://127.0.0.1:9000/app
curl -s -o /dev/null -w "  /store/... → %{http_code}\n" --max-time 15 "http://127.0.0.1:9000/store/regions" -H "x-publishable-api-key: $(sudo -u postgres psql -d narazborku_store -tAc "select token from api_key where type = 'publishable' limit 1" | tr -d ' ')"

echo "=== последние строки журнала службы ==="
journalctl -u narazborku -n 12 --no-pager | tail -12
