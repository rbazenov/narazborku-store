#!/bin/bash
# Настоящая причина шторма соединений: пароль пользователя medusa не совпадал с тем,
# что записан в .env — клиент бесконечно переподключался (auth failed → retry → ...).
# Здесь: берём пароль ровно из .env, ставим его пользователю, проверяем клиентом Node.
set -u

ENV_FILE=/srv/narazborku/app/apps/backend/.env
DBPASS=$(sed -n 's#^DATABASE_URL=postgres://medusa:\([^@]*\)@.*#\1#p' "$ENV_FILE")
if [ -z "$DBPASS" ]; then echo "НЕ УДАЛОСЬ прочитать пароль из .env"; exit 1; fi
echo "пароль из .env: ${DBPASS:0:4}…${DBPASS: -4} (длина ${#DBPASS})"

echo "=== проверка текущего состояния аутентификации ==="
PGPASSWORD="$DBPASS" psql -h 127.0.0.1 -U medusa -d narazborku_store -tAc "select 'ok';" 2>&1 | head -2

echo "=== ставлю тот же пароль заново + возвращаю scram-sha-256 ==="
cat > /tmp/pw.sql <<'SQL'
ALTER SYSTEM SET password_encryption = 'scram-sha-256';
SQL
sudo -u postgres psql -q -f /tmp/pw.sql
sudo -u postgres psql -q -c "ALTER SYSTEM SET password_encryption = 'scram-sha-256';"
systemctl restart postgresql
for i in $(seq 1 40); do sudo -u postgres psql -tAc "select 1;" >/dev/null 2>&1 && break; sleep 2; done

sudo -u postgres psql -c "ALTER USER medusa WITH PASSWORD '$DBPASS';" 2>&1 | head -3

echo "=== проверка psql ==="
PGPASSWORD="$DBPASS" psql -h 127.0.0.1 -U medusa -d narazborku_store -tAc "select 'psql: подключение ok';" 2>&1 | head -2

echo "=== проверка клиентом Node (как у Medusa) ==="
cd /srv/narazborku/app/apps/backend/.medusa/server && timeout 60 node /root/test-pg-client.js 2>&1 | head -6
