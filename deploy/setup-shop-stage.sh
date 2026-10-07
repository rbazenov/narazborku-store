#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Тестовый стенд магазина: копия боевого магазина с отдельной базой.
#
#   адрес:  https://test.77-233-221-183.sslip.io   (позже можно перевести на
#           test.finklass.online — понадобится запись DNS в зоне finklass.online)
#   база:   narazborku_stage   (боевая narazborku_store не затрагивается)
#   порт:   9001 (боевой — 9000)
#   redis:  база 1 (боевая — база 0)
#
# Что делает: копирует приложение, заводит базу, применяет миграции, наполняет
# каталог, заводит админа и выпускает сертификат. Боевой магазин не трогает.
#
# Запуск:  bash /root/setup-shop-stage.sh
# ---------------------------------------------------------------------------
set -euo pipefail

PROD=/srv/narazborku/app
STAGE=/srv/narazborku/stage/app
DOMAIN=test.77-233-221-183.sslip.io
DBNAME=narazborku_stage
PORT=9001
PGUSER=medusa
PGPASS=91716412c69b94b278f46d33b8d193a6
ADMIN_EMAIL=prodjectmen@gmail.com
ADMIN_PASS=Nb2026-7aa4e8
CERT_EMAIL=admin@narazborku.ru

echo "== 1. база стенда =="
if sudo -u postgres psql -tAc "select 1 from pg_database where datname = '$DBNAME'" | grep -q 1; then
  echo "   база $DBNAME уже есть — наполнение с нуля не требуется"
  NEWDB=no
else
  sudo -u postgres psql -q -c "create database $DBNAME owner $PGUSER;"
  echo "   база $DBNAME создана"
  NEWDB=yes
fi

echo
echo "== 2. копия приложения =="
mkdir -p "$(dirname "$STAGE")"
if [ ! -d "$STAGE/apps/backend" ]; then
  # копируем без резервных сборок (server-bak-*) — они занимают много места
  rsync -a --exclude 'server-bak-*' --exclude '.static-keep' "$PROD/" "$STAGE/"
  echo "   скопировано: $(du -sh "$STAGE" | cut -f1)"
else
  echo "   копия уже есть — обновляю исходники из боевого"
  rsync -a --exclude 'server-bak-*' --exclude '.static-keep' --exclude '.medusa' "$PROD/apps/backend/src/" "$STAGE/apps/backend/src/"
  rsync -a "$PROD/apps/backend/medusa-config.ts" "$STAGE/apps/backend/medusa-config.ts"
fi
chown -R medusa:medusa /srv/narazborku/stage

echo
echo "== 3. настройки стенда (.env) =="
ENVFILE="$STAGE/apps/backend/.env"
if [ ! -f "$ENVFILE" ] || ! grep -q "$DBNAME" "$ENVFILE"; then
  JWT=$(openssl rand -hex 32)
  COOKIE=$(openssl rand -hex 32)
  CORS_COMMON="http://localhost:8080,http://127.0.0.1:8080,https://rbazenov.github.io,https://$DOMAIN,https://finklass.online,https://shop.finklass.online"
  cat > "$ENVFILE" <<EOF
NODE_ENV=production
DATABASE_URL=postgres://$PGUSER:$PGPASS@127.0.0.1:5432/$DBNAME
REDIS_URL=redis://127.0.0.1:6379/1
JWT_SECRET=$JWT
COOKIE_SECRET=$COOKIE
STORE_CORS=$CORS_COMMON
ADMIN_CORS=$CORS_COMMON
AUTH_CORS=$CORS_COMMON
MEDUSA_BACKEND_URL=https://$DOMAIN
MEDUSA_WORKER_MODE=shared
PORT=$PORT
SESSION_COOKIE_SECURE=true
EOF
  chown medusa:medusa "$ENVFILE"; chmod 600 "$ENVFILE"
  echo "   настройки записаны (секреты для стенда — свои)"
else
  echo "   настройки уже есть"
fi

# страница загрузки картинок — та же, что в боевом магазине
cp -f "$PROD/upload.html" "$STAGE/upload.html" 2>/dev/null || true
chown medusa:medusa "$STAGE/upload.html" 2>/dev/null || true

echo
echo "== 4. служба narazborku-stage =="
cat > /etc/systemd/system/narazborku-stage.service <<EOF
[Unit]
Description=НаРазборку — ТЕСТОВЫЙ стенд магазина (Medusa v2)
After=network.target postgresql.service redis-server.service

[Service]
Type=simple
User=medusa
WorkingDirectory=$STAGE/apps/backend/.medusa/server
EnvironmentFile=$STAGE/apps/backend/.env
Environment=NODE_OPTIONS=--max-old-space-size=640
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable narazborku-stage >/dev/null 2>&1

echo
echo "== 5. миграции стенда =="
if [ "$NEWDB" = "yes" ]; then
  cd "$STAGE/apps/backend"
  sudo -u medusa -H env NODE_ENV=production bash -lc "cd $STAGE/apps/backend && npx medusa db:migrate" 2>&1 | tail -4
else
  echo "   база уже была — миграции применяются при обновлении отдельно"
fi

echo
echo "== 6. наполнение каталога =="
if [ "$NEWDB" = "yes" ]; then
  cd "$STAGE/apps/backend"
  sudo -u medusa -H env NODE_ENV=production bash -lc "cd $STAGE/apps/backend && npm run seed:autoparts" 2>&1 | tail -6
else
  echo "   пропускаю (база не пустая)"
fi

echo
echo "== 7. админ стенда =="
cd "$STAGE/apps/backend"
sudo -u medusa -H env NODE_ENV=production bash -lc "cd $STAGE/apps/backend && npx medusa user -e $ADMIN_EMAIL -p '$ADMIN_PASS'" 2>&1 | tail -3 || \
  echo "   (пользователь уже есть)"

echo
echo "== 8. запуск =="
systemctl restart narazborku-stage
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$PORT/health" || true)
  [ "$code" = "200" ] && break
  sleep 2
done
echo "   локально: http://127.0.0.1:$PORT/health → $code"
systemctl is-active narazborku-stage

echo
echo "== 9. nginx и сертификат =="
cat > /etc/nginx/sites-available/narazborku-stage <<EOF
server {
    server_name $DOMAIN;

    client_max_body_size 50m;

    # Страница загрузки картинок для лендинга (выдаёт готовую ссылку)
    location = /upload {
        alias $STAGE/upload.html;
        default_type text/html;
    }

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
    }

    listen 80;
}
EOF
ln -sf /etc/nginx/sites-available/narazborku-stage /etc/nginx/sites-enabled/narazborku-stage
nginx -t && systemctl reload nginx
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$CERT_EMAIL" --redirect 2>&1 | tail -4
systemctl reload nginx

echo
echo "== 10. проверка снаружи =="
curl -s -o /dev/null -w "   https://$DOMAIN/health → %{http_code}\n" --max-time 20 "https://$DOMAIN/health"
curl -s -o /dev/null -w "   https://$DOMAIN/app → %{http_code}\n" --max-time 30 "https://$DOMAIN/app"
curl -s -o /dev/null -w "   https://$DOMAIN/upload → %{http_code}\n" --max-time 20 "https://$DOMAIN/upload"

echo
echo "СТЕНД ГОТОВ: https://$DOMAIN/app"
echo "   админ: $ADMIN_EMAIL / (тот же пароль, что и у боевого)"
echo "   боевой магазин не изменялся: https://shop.finklass.online"
