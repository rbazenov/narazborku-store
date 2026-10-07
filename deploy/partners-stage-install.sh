#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 1 этап «Товары партнёров по фид-ссылкам»: установка на ТЕСТОВЫЙ стенд.
#
# Что делает:
#   1) распаковывает код модуля partners (справочник разборок + сборщик фидов)
#      в приложение стенда;
#   2) регистрирует модуль в medusa-config.ts (идемпотентно);
#   3) добавляет скрипт npm run partners:fetch (идемпотентно);
#   4) применяет миграции базы стенда (таблицы partner, partner_product);
#   5) пересобирает стенд, сохраняя картинки из админки;
#   6) перезапускает службу стенда и проверяет адреса.
#
# Боевой магазин НЕ трогается: путь, база и служба у стенда свои.
# Запуск на сервере:  bash /root/partners-stage-install.sh /root/partners-stage.tgz
# ---------------------------------------------------------------------------
set -euo pipefail

STAGE=/srv/narazborku/stage
APP=$STAGE/app/apps/backend
SERVICE=narazborku-stage
BASE=https://test.77-233-221-183.sslip.io
TGZ=${1:-/root/partners-stage.tgz}

[ -f "$TGZ" ] || { echo "не найден архив: $TGZ"; exit 1; }

echo "=== 1. код модуля partners ==="
tar xzf "$TGZ" -C "$APP"
chown -R medusa:medusa "$APP/src/modules/partners" "$APP/src/jobs" "$APP/src/scripts" "$APP/src/admin/routes/partners" 2>/dev/null || true
chown -R medusa:medusa "$APP/src/api/admin/partners" "$APP/src/api/store/partners" 2>/dev/null || true
find "$APP/src/modules/partners" -type f | sed "s#$APP/##" | sort
ls -1 "$APP/src/jobs" | sed 's/^/  job: /'

echo
echo "=== 2. регистрация модуля в medusa-config.ts ==="
python3 - "$APP/medusa-config.ts" <<'PY'
import io, sys
p = sys.argv[1]
s = io.open(p, encoding="utf-8").read()
if "'./src/modules/partners'" in s:
    print("  уже зарегистрирован — файл не изменён")
else:
    anchor = "      resolve: './src/modules/messages',\n      options: {},\n    },\n"
    if anchor not in s:
        print("  ! не найден блок модуля messages — правку нужно проверить руками")
        raise SystemExit(2)
    add = anchor + ("    {\n"
                    "      // Товары партнёров-авторазборок по фид-ссылкам (сборщик + справочник)\n"
                    "      resolve: './src/modules/partners',\n"
                    "      options: {},\n"
                    "    },\n")
    io.open(p, "w", encoding="utf-8").write(s.replace(anchor, add, 1))
    print("  ok: модуль partners зарегистрирован")
PY
chown medusa:medusa "$APP/medusa-config.ts"

echo
echo "=== 3. скрипт npm run partners:fetch ==="
python3 - "$APP/package.json" <<'PY'
import io, sys
p = sys.argv[1]
s = io.open(p, encoding="utf-8").read()
if "partners:fetch" in s:
    print("  уже есть — файл не изменён")
else:
    old = '"reset-link": "medusa exec ./src/scripts/make-reset-link.ts"'
    if old not in s:
        print("  ! не найдена строка скрипта reset-link — правку нужно проверить руками")
        raise SystemExit(2)
    s = s.replace(old, old + ',\n    "partners:fetch": "medusa exec ./src/scripts/partners-fetch.ts"', 1)
    io.open(p, "w", encoding="utf-8").write(s)
    print("  ok: npm run partners:fetch добавлен")
PY
chown medusa:medusa "$APP/package.json"

echo
echo "=== 4. миграции базы стенда ==="
sudo -u medusa -H env NODE_ENV=production bash -lc "cd $APP && npx medusa db:migrate" 2>&1 | tail -15

echo
echo "=== 5. таблицы в базе ==="
DB=$(grep -E '^DATABASE_URL=' "$APP/.env" | cut -d= -f2- | tr -d '"' | sed 's#.*/##')
sudo -u postgres psql -d "$DB" -c "\dt partner" -c "\dt partner_product" 2>/dev/null | grep -E "partner|----" | head -8

echo
echo "=== 6. пересборка стенда (серверный код + админка) ==="
STATIC_KEEP=$STAGE/.static-keep
rm -rf "$STATIC_KEEP"
if [ -d "$APP/.medusa/server/static" ]; then
  cp -a "$APP/.medusa/server/static" "$STATIC_KEEP"
  echo "картинок из админки сохранено: $(ls "$STATIC_KEEP" | wc -l)"
fi
sudo -u medusa -H env NODE_ENV=production NODE_OPTIONS="--max-old-space-size=1536" \
  bash -lc "cd $APP && npm run build" 2>&1 | tail -12
if [ -d "$STATIC_KEEP" ]; then
  mkdir -p "$APP/.medusa/server/static"
  cp -an "$STATIC_KEEP/." "$APP/.medusa/server/static/" 2>/dev/null || true
  chown -R medusa:medusa "$APP/.medusa/server/static" 2>/dev/null || true
fi

echo
echo "=== 7. перезапуск стенда ==="
systemctl restart "$SERVICE"
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$BASE/health" || true)
  [ "$code" = "200" ] && break
  sleep 2
done
echo "  $BASE/health → ${code}"
echo "  админка /app → $(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$BASE/app")"
echo "  API /admin/partners (без входа ожидаем 401) → $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$BASE/admin/partners")"

echo
echo "=== 8. расписание сборщика (последние строки журнала) ==="
journalctl -u "$SERVICE" --no-pager -n 400 2>/dev/null | grep -i "partners" | tail -5 || echo "  сообщений сборщика пока нет (первый прогон — по расписанию)"

echo
echo "готово. Боевой магазин не трогали."
