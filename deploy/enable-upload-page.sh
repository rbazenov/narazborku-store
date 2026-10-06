#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Страница /upload на сайте магазина: владелец выбирает картинку, страница
# загружает её через админку и показывает готовую ссылку, которую нужно
# вставить в строку баннера на лендинге.
#
# Что делает скрипт:
#   1) кладёт upload-page.html рядом с приложением (/srv/narazborku/app/upload.html);
#   2) добавляет адрес /upload в конфигурации nginx тех доменов магазина,
#      которые перечислены в DOMAINS (по умолчанию основной и резервный);
#   3) убирает блок из чужих конфигураций, если он туда попал (домен лендинга
#      и shop.narazborku.ru не трогаем);
#   4) проверяет конфигурацию и перезагружает nginx.
# Идемпотентен: повторный запуск обновляет файл и ничего не ломает.
#
# Запуск:  bash /root/enable-upload-page.sh
# ---------------------------------------------------------------------------
set -euo pipefail

SRC=${SRC:-/root/upload-page.html}
DOMAINS=${DOMAINS:-"shop.finklass.online 77-233-221-183.sslip.io"}
APP=/srv/narazborku/app
DEST=$APP/upload.html

[ -f "$SRC" ] || { echo "нет файла страницы: $SRC"; exit 1; }
cp "$SRC" "$DEST"
chown medusa:medusa "$DEST" 2>/dev/null || true
chmod 644 "$DEST"
echo "страница: $DEST"

# какие конфигурации обслуживают домены магазина
TARGETS=""
for f in /etc/nginx/sites-available/*; do
  for d in $DOMAINS; do
    if grep -qE "server_name[^;]*\b${d//./\\.}\b" "$f"; then TARGETS="$TARGETS $f"; break; fi
  done
done
TARGETS=$(echo $TARGETS | tr ' ' '\n' | sort -u | tr '\n' ' ')
[ -n "$TARGETS" ] || { echo "не нашёл конфигурацию для доменов: $DOMAINS"; exit 1; }
echo "конфигурации магазина: $TARGETS"

python3 - "$TARGETS" -- /etc/nginx/sites-available/* <<'PY'
import io, re, sys
args = sys.argv[1:]
sep = args.index('--')
targets = set()
for a in args[:sep]:
    targets.update(a.split())
others = args[sep + 1:]

BLOCK = """    # Страница загрузки картинок для лендинга (выдаёт готовую ссылку)
    location = /upload {
        alias /srv/narazborku/app/upload.html;
        default_type text/html;
    }

"""

def read(p):
    return io.open(p, encoding='utf-8').read()

def write(p, s):
    io.open(p, 'w', encoding='utf-8').write(s)

for p in sorted(targets):
    s = read(p)
    if 'location = /upload' in s:
        print('  %s: адрес /upload уже настроен' % p)
        continue
    m = re.search(r'^\s*location\s+/\s*\{', s, re.M)
    if not m:
        print('  %s: нет блока location / — пропускаю' % p)
        continue
    s = s[:m.start()] + BLOCK + s[m.start():]
    write(p, s)
    print('  %s: адрес /upload добавлен' % p)

# чистим ошибочно добавленный блок в остальных конфигурациях
for p in sorted(others):
    if p in targets:
        continue
    s = read(p)
    if 'location = /upload' not in s:
        continue
    s2 = re.sub(r'\n?[ \t]*# Страница загрузки картинок для лендинга[^\n]*\n[ \t]*location = /upload \{[^}]*\}\n', '\n', s)
    if s2 != s:
        write(p, s2)
        print('  %s: лишний блок /upload убран' % p)
PY

nginx -t
systemctl reload nginx
echo "nginx перезагружен"
for d in $DOMAINS; do
  echo "  https://$d/upload → $(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://$d/upload)"
done
