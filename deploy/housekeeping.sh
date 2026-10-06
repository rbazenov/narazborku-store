#!/bin/bash
# Хозяйственные шаги, которые не добрались до конца при первой установке:
# ежедневный дамп базы, файрвол, проверка службы и места на диске.
set -u

DBPASS=$(sed -n 's#^DATABASE_URL=postgres://medusa:\([^@]*\)@.*#\1#p' /srv/narazborku/app/apps/backend/.env)
DB_NAME=narazborku_store
DB_USER=medusa

echo "=== 1. ежедневный дамп базы ==="
mkdir -p /var/backups/narazborku
cat > /etc/cron.daily/narazborku-db-dump <<EOF
#!/bin/sh
pg_dump -U $DB_USER -h 127.0.0.1 $DB_NAME | gzip > /var/backups/narazborku/db-\$(date +%F).sql.gz
ls -t /var/backups/narazborku/db-*.sql.gz | tail -n +8 | xargs -r rm
EOF
chmod +x /etc/cron.daily/narazborku-db-dump
echo "127.0.0.1:5432:$DB_NAME:$DB_USER:$DBPASS" > /root/.pgpass
chmod 600 /root/.pgpass
chown postgres:postgres /var/backups/narazborku 2>/dev/null || true
echo "    создан /etc/cron.daily/narazborku-db-dump (хранение 7 дней)"

echo "=== 2. файрвол ==="
ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 'Nginx Full' >/dev/null 2>&1 || true
yes | ufw enable >/dev/null 2>&1 || true
ufw status | head -6

echo "=== 3. служба ==="
systemctl is-enabled narazborku 2>/dev/null
systemctl is-active narazborku
systemctl show narazborku -p Restart | head -1

echo "=== 4. диск и память ==="
df -h / | tail -1
free -m | head -2

echo "=== 5. проверка работоспособности ==="
curl -s -o /dev/null -w "    /health → %{http_code}\n" --max-time 10 http://127.0.0.1:9000/health
curl -s -o /dev/null -w "    /app    → %{http_code}\n" --max-time 15 http://127.0.0.1:9000/app
echo "    товаров в базе: $(sudo -u postgres psql -d $DB_NAME -tAc 'select count(1) from product where deleted_at is null;')"
echo "    пользователей админки: $(sudo -u postgres psql -d $DB_NAME -tAc 'select count(1) from "user" where deleted_at is null;')"
echo "=== 6. тестовый дамп ==="
PGPASSWORD="$DBPASS" pg_dump -U $DB_USER -h 127.0.0.1 $DB_NAME | gzip > /var/backups/narazborku/db-test.sql.gz && \
  ls -lh /var/backups/narazborku/db-test.sql.gz | awk '{print "    дамп создан:", $5}' && rm -f /var/backups/narazborku/db-test.sql.gz
