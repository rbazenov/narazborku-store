#!/usr/bin/env bash
# =============================================================================
#  «НаРазборку» — установка магазина Medusa v2 на чистый сервер Ubuntu 24.04.
#
#  Что делает (всё автоматически):
#    Postgres + Redis + Node 22 + nginx + HTTPS + автозапуск + ежедневные дампы БД.
#
#  Запуск (пример):
#    DOMAIN=shop.narazborku.ru \
#    REPO=https://<токен>@github.com/rbazenov/narazborku-store.git \
#    ADMIN_EMAIL=admin@narazborku.ru \
#    ADMIN_PASSWORD='Narazborku2026!' \
#    LE_EMAIL=admin@narazborku.ru \
#    bash server-setup.sh
#
#  Полезные переменные:
#    SEED_DEMO=1   — залить демо-каталог запчастей (10 позиций) для проверки
#    SKIP_SSL=1    — не выпускать SSL (если DNS ещё не указывает на сервер)
# =============================================================================
set -euo pipefail

DOMAIN="${DOMAIN:-shop.narazborku.ru}"
REPO="${REPO:-}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@narazborku.ru}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
LE_EMAIL="${LE_EMAIL:-$ADMIN_EMAIL}"
SEED_DEMO="${SEED_DEMO:-0}"
SKIP_SSL="${SKIP_SSL:-0}"

APP_USER="medusa"
APP_DIR="/srv/narazborku"
BACKEND="$APP_DIR/app/apps/backend"
DB_NAME="narazborku_store"
DB_USER="medusa"
DB_PASS="$(openssl rand -hex 16)"

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then echo "Запускать от root (или через sudo)."; exit 1; fi
[ -n "$REPO" ] || { echo "Не задан REPO — откуда брать код магазина."; exit 1; }
[ -n "$ADMIN_PASSWORD" ] || ADMIN_PASSWORD="$(openssl rand -base64 12)"

export DEBIAN_FRONTEND=noninteractive

say "1/10  Системные пакеты"
apt-get update -qq
apt-get install -y -qq curl git ca-certificates gnupg ufw \
  postgresql postgresql-contrib redis-server nginx \
  certbot python3-certbot-nginx openssl

say "2/10  Swap (страховка при сборке)"
TOTAL_RAM_MB="$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)"
# Сборка Medusa требует ~2.5–3 ГБ. На серверах с 2–4 ГБ памяти без swap сборку
# убивает OOM — поэтому на малых конфигурациях делаем swap побольше.
if [ "$TOTAL_RAM_MB" -lt 4096 ]; then SWAP_SIZE=4G; else SWAP_SIZE=2G; fi
echo "    памяти: ${TOTAL_RAM_MB} МБ → swap ${SWAP_SIZE}"
if ! swapon --show | grep -q swap; then
  fallocate -l "$SWAP_SIZE" /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # активнее выгружать в swap, чтобы не ловить OOM на пиках
  sysctl -q vm.swappiness=20
  grep -q 'vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=20' >> /etc/sysctl.conf
fi

# Настройка PostgreSQL и Redis под объём памяти сервера
if [ "$TOTAL_RAM_MB" -lt 4096 ]; then
  say "    тюнинг PostgreSQL/Redis под малую память"
  systemctl start postgresql redis-server >/dev/null 2>&1 || true
  sleep 2
  sudo -u postgres psql -q -c "ALTER SYSTEM SET shared_buffers = '256MB';" \
    -c "ALTER SYSTEM SET effective_cache_size = '768MB';" \
    -c "ALTER SYSTEM SET work_mem = '8MB';" \
    -c "ALTER SYSTEM SET maintenance_work_mem = '64MB';" \
    -c "ALTER SYSTEM SET max_connections = 60;" >/dev/null
  systemctl restart postgresql
  sed -i -E "s/^# *maxmemory .*/maxmemory 256mb/; s/^# *maxmemory-policy .*/maxmemory-policy noeviction/" /etc/redis/redis.conf
  grep -q '^maxmemory ' /etc/redis/redis.conf || echo 'maxmemory 256mb' >> /etc/redis/redis.conf
  grep -q '^maxmemory-policy ' /etc/redis/redis.conf || echo 'maxmemory-policy noeviction' >> /etc/redis/redis.conf
  systemctl restart redis-server
fi

say "3/10  Node.js 22"
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs
fi
node -v; npm -v

say "4/10  PostgreSQL и Redis"
systemctl enable --now postgresql >/dev/null 2>&1
systemctl enable --now redis-server >/dev/null 2>&1
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS' CREATEDB;"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"

say "5/10  Пользователь и код"
id -u "$APP_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$APP_USER"
mkdir -p "$APP_DIR"
if [ -d "$APP_DIR/app/.git" ]; then
  sudo -u "$APP_USER" git -C "$APP_DIR/app" pull --ff-only
else
  sudo -u "$APP_USER" git clone "$REPO" "$APP_DIR/app"
fi

say "6/10  Зависимости магазина"
sudo -u "$APP_USER" bash -lc "cd $APP_DIR/app && npm install --no-audit --no-fund"

say "7/10  Файл окружения (.env)"
ENV_FILE="$BACKEND/.env"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
DATABASE_URL=postgres://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=$(openssl rand -hex 32)
COOKIE_SECRET=$(openssl rand -hex 32)
STORE_CORS=https://$DOMAIN,https://narazborku.ru,https://www.narazborku.ru
ADMIN_CORS=https://$DOMAIN
AUTH_CORS=https://$DOMAIN,https://narazborku.ru,https://www.narazborku.ru
MEDUSA_BACKEND_URL=https://$DOMAIN
MEDUSA_WORKER_MODE=shared
PORT=9000
EOF
  chown "$APP_USER:$APP_USER" "$ENV_FILE"; chmod 600 "$ENV_FILE"
  echo "    .env создан (секреты сгенерированы)"
else
  echo "    .env уже есть — не трогаю"
fi

say "8/10  Сборка магазина (на слабом сервере 15–30 минут)"
HEAP_MB=$(( TOTAL_RAM_MB > 4096 ? 3072 : 1400 ))
echo "    памяти ${TOTAL_RAM_MB} МБ → heap сборки ${HEAP_MB} МБ (при нехватке подключится swap)"
sudo -u "$APP_USER" bash -lc "cd $BACKEND && NODE_OPTIONS=--max-old-space-size=$HEAP_MB npm run build"
sudo -u "$APP_USER" bash -lc "cd $BACKEND/.medusa/server && npm install --no-audit --no-fund --omit=dev"
# освобождаем место на диске (на 30 ГБ это существенно)
sudo -u "$APP_USER" bash -lc "cd $BACKEND && npm cache clean --force >/dev/null 2>&1 || true"
sudo -u "$APP_USER" bash -lc "rm -rf $BACKEND/node_modules/.cache $APP_DIR/app/node_modules/.cache"
df -h / | tail -1 | awk '{print "    свободно на диске: "$4" из "$2}'

say "9/10  Автозапуск (systemd), nginx, HTTPS"
cat > /etc/systemd/system/narazborku.service <<EOF
[Unit]
Description=НаРазборку — магазин (Medusa v2)
After=network.target postgresql.service redis-server.service

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$BACKEND/.medusa/server
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable narazborku >/dev/null
systemctl restart narazborku

cat > /etc/nginx/sites-available/narazborku <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:9000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
    }
}
EOF
ln -sf /etc/nginx/sites-available/narazborku /etc/nginx/sites-enabled/narazborku
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

if [ "$SKIP_SSL" = "1" ]; then
  echo "    SSL пропущен (SKIP_SSL=1)"
else
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$LE_EMAIL" --redirect || \
    echo "    ⚠ SSL не выпущен: проверьте, что A-запись $DOMAIN уже указывает на этот сервер, и запустите: certbot --nginx -d $DOMAIN"
fi

ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 'Nginx Full' >/dev/null 2>&1 || true
yes | ufw enable >/dev/null 2>&1 || true

say "Пользователь админки"
sudo -u "$APP_USER" bash -lc "cd $BACKEND && npx medusa user -e '$ADMIN_EMAIL' -p '$ADMIN_PASSWORD'" || \
  echo "    (пользователь уже существует или будет создан вручную)"

if [ "$SEED_DEMO" = "1" ]; then
  say "Демо-каталог запчастей"
  sudo -u "$APP_USER" bash -lc "cd $BACKEND && npx medusa exec ./src/scripts/seed-narazborku-autoparts.ts"
fi

say "Ежедневный дамп базы (хранится 7 дней)"
mkdir -p /var/backups/narazborku
cat > /etc/cron.daily/narazborku-db-dump <<EOF
#!/bin/sh
pg_dump -U $DB_USER -h 127.0.0.1 $DB_NAME | gzip > /var/backups/narazborku/db-\$(date +%F).sql.gz
ls -t /var/backups/narazborku/db-*.sql.gz | tail -n +8 | xargs -r rm
EOF
chmod +x /etc/cron.daily/narazborku-db-dump
echo "127.0.0.1:5432:$DB_NAME:$DB_USER:$DB_PASS" > /root/.pgpass && chmod 600 /root/.pgpass

say "Готово"
cat <<EOF

  Магазин:  https://$DOMAIN
  Админка:  https://$DOMAIN/app
  Логин:    $ADMIN_EMAIL
  Пароль:   $ADMIN_PASSWORD

  Проверить состояние:  systemctl status narazborku
  Логи:                 journalctl -u narazborku -f

  Пароль БД записан в $ENV_FILE и в /root/.pgpass.
  После проверки смените пароль админки в панели (Настройки → Пользователи).
EOF
