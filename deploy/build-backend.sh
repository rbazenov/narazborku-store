#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Пересборка магазина на сервере: серверный код + админ-панель.
#
# Что делает:
#   1) пересобирает приложение из исходников (apps/backend) в .medusa/server;
#   2) показывает, что получилось (админка, конфигурация, модуль сообщений).
#
# После сборки нужно применить миграции и перезапустить службу:
#   bash /root/apply-migrations.sh
#
# Запуск:  bash /root/build-backend.sh
# ---------------------------------------------------------------------------
set -euo pipefail
APP=/srv/narazborku/app/apps/backend

cd "$APP"

# сборка идёт из-под служебного пользователя, чтобы файлы остались его
sudo -u medusa -H env NODE_ENV=production bash -lc "cd $APP && npm run build" 2>&1 | tail -30

echo
echo "=== что собралось ==="
ls -la "$APP/.medusa/server" | head -8
echo "админка:"
ls "$APP/.medusa/server/public/admin" | head -4
echo "модуль сообщений в сборке:"
ls "$APP/.medusa/server/src/modules/messages" 2>/dev/null | head -6 || echo "  (нет — проверь конфигурацию)"
echo "миграции модуля:"
ls "$APP/.medusa/server/src/modules/messages/migrations" 2>/dev/null | head -4 || true
echo "провайдер файлов и модули в собранной конфигурации:"
grep -n "backend_url\|messages" "$APP/.medusa/server/medusa-config.js" | head -6
