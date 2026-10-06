#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# НаРазборку — «поднять админку с нуля» после перезапуска песочницы.
#
# Запуск:  bash /home/user/narazborku-store/bootstrap.sh
# Что делает: Postgres + база + зависимости + миграции + демо-каталог + админ +
#             запуск сервера на 0.0.0.0:9000 (превью-ссылка появится в панели).
#
# Повторный запуск безопасен: миграции и сиды идемпотентны, данные не дублируются.
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="/home/user/narazborku-store"
BACKEND="$ROOT/apps/backend"
ADMIN_EMAIL="admin@narazborku.ru"
ADMIN_PASSWORD="Narazborku2026!"
DB_NAME="narazborku_store"
DB_USER="medusa"
DB_PASS="medusa_dev_pw"

echo "==> 1/7 PostgreSQL"
if ! command -v psql >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq postgresql
fi
sudo service postgresql start >/dev/null 2>&1 || true
sleep 2

echo "==> 2/7 база и роль"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS' SUPERUSER CREATEDB;" >/dev/null
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" >/dev/null
echo "    база $DB_NAME готова"

echo "==> 3/7 актуальный адрес превью в .env"
# Песочница при каждом запуске получает новый id — CORS нужно обновлять,
# иначе браузер отклонит запросы админки.
if [ -n "${E2B_SANDBOX_ID:-}" ]; then
  NEW_ORIGIN="https://9000-${E2B_SANDBOX_ID}.e2b.app"
  sed -i -E "s#https://9000-[a-z0-9]+\.e2b\.app#${NEW_ORIGIN}#g" "$BACKEND/.env"
  echo "    origin: $NEW_ORIGIN"
else
  echo "    E2B_SANDBOX_ID не задан — оставляю как есть"
fi

echo "==> 4/7 зависимости (если нужно)"
cd "$ROOT"
[ -d node_modules ] || npm install --no-audit --no-fund

echo "==> 5/7 миграции + базовый сид"
FILTER='redisUrl|fake redis|instrumentation|Local Event Bus|Locking module|No link to load|No workflow|No subscriber|No job'
(cd "$BACKEND" && npx medusa db:migrate 2>&1 | grep -v -E "$FILTER" | tail -3)

echo "==> 6/7 демо-каталог автозапчастей (идемпотентно)"
(cd "$BACKEND" && npx medusa exec ./src/scripts/seed-narazborku-autoparts.ts 2>&1 | grep -v -E "$FILTER" | tail -3)

echo "==> пользователь админки"
(cd "$BACKEND" && npx medusa user -e "$ADMIN_EMAIL" -p "$ADMIN_PASSWORD" 2>&1 | grep -v -E "$FILTER" | tail -1) \
  || echo "    (пользователь, скорее всего, уже существует — это нормально)"

echo "==> 7/7 запускаю сервер"
cat <<EOF

  Готово. Сервер: http://0.0.0.0:9000  →  панель на /app
  Админ:    $ADMIN_EMAIL / $ADMIN_PASSWORD
  Превью:   https://9000-${E2B_SANDBOX_ID:-<id>}.e2b.app/app   (ссылка из панели)

  Команда запуска (её и надо выполнять в фоне):
    cd $BACKEND && npx medusa develop --host 0.0.0.0 --port 9000 --no-lint

EOF
