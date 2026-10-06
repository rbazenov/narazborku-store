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

# ВАЖНО: сборка пересоздаёт .medusa/server, а вместе с ней и папку static —
# в ней лежат картинки, загруженные владельцем через админку. Перед сборкой
# откладываем её в сторону, после сборки возвращаем на место.
STATIC_KEEP=/srv/narazborku/app/.static-keep
rm -rf "$STATIC_KEEP"
if [ -d "$APP/.medusa/server/static" ]; then
  cp -a "$APP/.medusa/server/static" "$STATIC_KEEP"
  echo "картинок из админки сохранено: $(ls "$STATIC_KEEP" | wc -l)"
fi

# сборка идёт из-под служебного пользователя, чтобы файлы остались его
# памяти на сервере немного: сборке админки нужен лимит около 1,5 ГБ
sudo -u medusa -H env NODE_ENV=production NODE_OPTIONS="--max-old-space-size=1536" \
  bash -lc "cd $APP && npm run build" 2>&1 | tail -30

# возвращаем картинки владельца и дополняем их теми, что в резервных сборках
if [ -d "$STATIC_KEEP" ]; then
  mkdir -p "$APP/.medusa/server/static"
  cp -an "$STATIC_KEEP/." "$APP/.medusa/server/static/" 2>/dev/null || true
  echo "картинки из админки возвращены: $(ls "$APP/.medusa/server/static" | wc -l)"
fi
for BAK in "$APP"/.medusa/server-bak-*/; do
  [ -d "${BAK}static" ] || continue
  cp -an "${BAK}static/." "$APP/.medusa/server/static/" 2>/dev/null || true
done
chown -R medusa:medusa "$APP/.medusa/server/static" 2>/dev/null || true
echo "картинок в новой сборке всего: $(ls "$APP/.medusa/server/static" 2>/dev/null | wc -l)"

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
