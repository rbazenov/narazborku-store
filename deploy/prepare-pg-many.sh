#!/bin/bash
# Подготовка PostgreSQL к пиковой нагрузке миграций Medusa (~300 соединений):
#  - убираем искусственное ограничение пула (оно мешало самой Medusa подключаться)
#  - поднимаем лимиты процессов/файлов для postgresql.service
#  - выключаем JIT и лишние параллельные воркеры (сервер с 1 ядром)
set -u

echo "=== 1. останавливаю текущие попытки ==="
pkill -f "medusa db:migrate" 2>/dev/null || true
pkill -f "npm run predeploy" 2>/dev/null || true
sleep 3

echo "=== 2. снимаю ограничение пула в собранном конфиге ==="
python3 - <<'PY'
import pathlib, re
p = pathlib.Path("/srv/narazborku/app/apps/backend/.medusa/server/medusa-config.js")
s = p.read_text()
s = re.sub(r"\s*databaseDriverOptions: \{.*?\},", "", s, count=1, flags=re.S)
p.write_text(s)
print("databaseDriverOptions удалён" if "databaseDriverOptions" not in s else "остался!")
PY

echo "=== 3. лимиты systemd для PostgreSQL ==="
mkdir -p /etc/systemd/system/postgresql.service.d
cat > /etc/systemd/system/postgresql.service.d/limits.conf <<'EOF'
[Service]
TasksMax=infinity
LimitNOFILE=65535
LimitNPROC=infinity
EOF
systemctl daemon-reload

echo "=== 4. настройки PostgreSQL под многопоточные миграции ==="
cat > /tmp/pg-tune.sql <<'SQL'
ALTER SYSTEM SET max_connections = 500;
ALTER SYSTEM SET superuser_reserved_connections = 5;
ALTER SYSTEM SET shared_buffers = '128MB';
ALTER SYSTEM SET work_mem = '4MB';
ALTER SYSTEM SET maintenance_work_mem = '64MB';
ALTER SYSTEM SET effective_cache_size = '512MB';
ALTER SYSTEM SET jit = off;
ALTER SYSTEM SET max_parallel_workers_per_gather = 0;
ALTER SYSTEM SET max_worker_processes = 8;
ALTER SYSTEM SET password_encryption = 'md5';
SQL
sudo -u postgres psql -q -f /tmp/pg-tune.sql
systemctl restart postgresql
for i in $(seq 1 40); do
  sudo -u postgres psql -tAc "select 1;" >/dev/null 2>&1 && break
  sleep 2
done

echo "=== 5. проверка ==="
sudo -u postgres psql -tAc "show max_connections;"
sudo -u postgres psql -tAc "select count(*) from pg_stat_activity;"
nproc
echo "=== задачи в cgroup postgresql ==="
systemctl show postgresql -p TasksMax | head -1
