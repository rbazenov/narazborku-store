#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Адрес картинок, загруженных через админку, должен вести на сайт магазина.
#
# Почему: файловый провайдер Medusa (@medusajs/file-local) по умолчанию
# подставляет http://localhost:9000/static/… — такую ссылку нельзя вставить
# на лендинг, она не открывается ни у кого, кроме самого сервера.
# Лечится настройкой backend_url у провайдера: админка сразу отдаёт
# https://shop.finklass.online/static/имя-файла.png
#
# Скрипт: правит собранную конфигурацию (её и запускает служба) и исходную
# (чтобы настройка не потерялась при пересборке), перезапускает магазин
# и проверяет, какую ссылку выдаёт загрузка. Идемпотентен.
#
# Запуск:  bash /root/fix-upload-urls.sh
# ---------------------------------------------------------------------------
set -euo pipefail
APP=/srv/narazborku/app/apps/backend
STAMP=$(date +%Y%m%d-%H%M%S)

cp "$APP/.medusa/server/medusa-config.js" "$APP/.medusa/server/medusa-config.js.bak-$STAMP"
cp "$APP/medusa-config.ts" "$APP/medusa-config.ts.bak-$STAMP"
echo "бэкапы: medusa-config.js.bak-$STAMP, medusa-config.ts.bak-$STAMP"

python3 - "$APP" <<'PY'
import io, re, sys
app = sys.argv[1]

BLOCK_JS = """
    // Ссылки на загруженные картинки ведут на сайт магазина, а не на localhost:9000
    modules: [
        {
            resolve: '@medusajs/file',
            options: {
                providers: [
                    {
                        resolve: '@medusajs/file-local',
                        id: 'local',
                        options: {
                            backend_url: `${process.env.MEDUSA_BACKEND_URL || 'https://shop.finklass.online'}/static`,
                        },
                    },
                ],
            },
        },
    ],
"""

BLOCK_TS = """
  // Ссылки на загруженные картинки ведут на сайт магазина, а не на localhost:9000
  modules: [
    {
      resolve: '@medusajs/file',
      options: {
        providers: [
          {
            resolve: '@medusajs/file-local',
            id: 'local',
            options: {
              backend_url: `${process.env.MEDUSA_BACKEND_URL || 'https://shop.finklass.online'}/static`,
            },
          },
        ],
      },
    },
  ],
"""

# 1) собранная конфигурация — её запускает служба
p = app + '/.medusa/server/medusa-config.js'
s = io.open(p, encoding='utf-8').read()
if 'backend_url' in s:
    print('  собранная конфигурация: уже настроено')
else:
    i = s.rstrip().rfind('});')
    assert i > 0, 'не нашёл конец конфигурации'
    s = s[:i] + BLOCK_JS + s[i:]
    io.open(p, 'w', encoding='utf-8').write(s)
    print('  собранная конфигурация: настройка добавлена')

# 2) исходная конфигурация — на случай пересборки
p = app + '/medusa-config.ts'
s = io.open(p, encoding='utf-8').read()
if 'backend_url' in s:
    print('  исходная конфигурация: уже настроено')
else:
    i = s.rstrip().rfind('})')
    assert i > 0, 'не нашёл конец конфигурации (ts)'
    s = s[:i] + BLOCK_TS + s[i:]
    io.open(p, 'w', encoding='utf-8').write(s)
    print('  исходная конфигурация: настройка добавлена')
PY

node --check "$APP/.medusa/server/medusa-config.js" && echo "синтаксис собранной конфигурации ✔"

echo "перезапускаю магазин…"
systemctl restart narazborku
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 https://shop.finklass.online/health || true)
  [ "$code" = "200" ] && break
  sleep 2
done
echo "магазин: https://shop.finklass.online/health → ${code}"

# тестовый файл (96 Б) — чтобы проверить загрузку без внешних файлов
python3 -c "
import base64
open('/tmp/test-banner-img.png','wb').write(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAJklEQVR42u3OMQEAAAgDoC251a3gLwSgOXLVkiRJkiRJkiRJkiRJ0iN6AAGq1k4xAAAAAElFTkSuQmCC'))
print('  тестовый файл /tmp/test-banner-img.png готов')
"

TOKEN=$(curl -s -X POST https://shop.finklass.online/auth/user/emailpass \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"prodjectmen@gmail.com\",\"password\":\"${ADMIN_PASS:?нужен ADMIN_PASS}\"}" \
  --max-time 30 | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))')

echo "проверяю, какую ссылку выдаёт загрузка:"
ANS=$(curl -s -X POST https://shop.finklass.online/admin/uploads -H "Authorization: Bearer $TOKEN" \
  -F "files=@/tmp/test-banner-img.png" --max-time 40)
echo "  $ANS"
URL=$(echo "$ANS" | python3 -c 'import sys,json;print(json.load(sys.stdin)["files"][0]["url"])')
echo "  файл по этой ссылке: $(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$URL")"
echo "$URL" > /root/last-upload-url.txt
