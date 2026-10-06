#!/bin/bash
# Включает админку/API по IP (пока не настроен DNS), сохраняя оригинал бандла,
# либо возвращает доменное состояние:  bash ip-mode.sh on|off
set -u
S=/srv/narazborku/app/apps/backend/.medusa/server
ENV=/srv/narazborku/app/apps/backend/.env
JS=$(ls $S/public/admin/assets/index-*.js | head -1)
MODE=${1:-on}

if [ "$MODE" = "on" ]; then
  [ -f "$JS.orig" ] || cp "$JS" "$JS.orig"
  sed -i 's#https://shop\.narazborku\.ru#http://77.233.221.183#g' "$JS"
  sed -i 's#^MEDUSA_BACKEND_URL=.*#MEDUSA_BACKEND_URL=http://77.233.221.183#' "$ENV"
  sed -i 's#^ADMIN_CORS=.*#ADMIN_CORS=http://77.233.221.183,https://shop.narazborku.ru#' "$ENV"
  sed -i 's#^AUTH_CORS=\(.*\)#AUTH_CORS=http://77.233.221.183,\1#' "$ENV"
  sed -i 's#^STORE_CORS=\(.*\)#STORE_CORS=http://77.233.221.183,\1#' "$ENV"
  echo "включён режим IP: админка http://77.233.221.183/app"
else
  [ -f "$JS.orig" ] && cp "$JS.orig" "$JS" || echo "оригинал бандла не найден — потребуется пересборка (npm run build)"
  sed -i 's#^MEDUSA_BACKEND_URL=.*#MEDUSA_BACKEND_URL=https://shop.narazborku.ru#' "$ENV"
  sed -i 's#^ADMIN_CORS=.*#ADMIN_CORS=https://shop.narazborku.ru#' "$ENV"
  sed -i 's#^AUTH_CORS=.*#AUTH_CORS=https://shop.narazborku.ru,https://narazborku.ru,https://www.narazborku.ru#' "$ENV"
  sed -i 's#^STORE_CORS=.*#STORE_CORS=https://shop.narazborku.ru,https://narazborku.ru,https://www.narazborku.ru#' "$ENV"
  echo "включён режим домена: админка https://shop.narazborku.ru/app"
fi

chown medusa:medusa "$JS" "$ENV"
chmod 600 "$ENV"
systemctl restart narazborku
for i in $(seq 1 20); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:9000/health)" = "200" ] && break
  sleep 3
done
echo "health: $(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:9000/health)"
grep -E '^(MEDUSA_BACKEND_URL|ADMIN_CORS|AUTH_CORS|STORE_CORS)=' "$ENV"
