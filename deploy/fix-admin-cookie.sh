#!/bin/bash
# Починка входа в админку: cookie сессии в продакшене помечается Secure,
# и по http:// браузер её не сохраняет -> после успешного входа сразу 401.
# Задаём projectConfig.cookieOptions.secure=false на время работы по IP.
set -u
S=/srv/narazborku/app/apps/backend/.medusa/server
ENV=/srv/narazborku/app/apps/backend/.env

echo "=== 1. сохраняю копию конфига ==="
cp $S/medusa-config.js /root/medusa-config.js.bak-$(date +%H%M) && echo "    копия сделана"

echo "=== 2. добавляю cookieOptions в рабочий конфиг ==="
python3 - <<'PY'
import pathlib, re
p = pathlib.Path("/srv/narazborku/app/apps/backend/.medusa/server/medusa-config.js")
s = p.read_text()
if "cookieOptions" in s:
    print("    уже добавлено — пропускаю")
else:
    block = """        cookieOptions: {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.SESSION_COOKIE_SECURE !== 'false',
        },
"""
    marker = "        http: {\n"
    assert marker in s, "не найден блок http"
    s = s.replace(marker, block + marker, 1)
    p.write_text(s)
    print("    добавлено")
PY

echo "=== 3. добавляю переменную в .env ==="
grep -q '^SESSION_COOKIE_SECURE=' $ENV || echo 'SESSION_COOKIE_SECURE=false' >> $ENV
sed -i 's#^SESSION_COOKIE_SECURE=.*#SESSION_COOKIE_SECURE=false#' $ENV
chown medusa:medusa $ENV; chmod 600 $ENV
grep '^SESSION_COOKIE_SECURE=' $ENV

echo "=== 4. проверяю, что конфиг загружается ==="
cd $S && node -e "
const c = require('./medusa-config.js');
const pc = (typeof c === 'function' ? c() : c).projectConfig || c.projectConfig;
console.log('    cookieOptions:', JSON.stringify(pc.cookieOptions));
" 2>&1 | tail -3

echo "=== 5. перезапуск ==="
systemctl restart narazborku
for i in $(seq 1 25); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:9000/health)" = "200" ] && break
  sleep 3
done
echo "    health: $(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:9000/health)"

echo "=== 6. полный вход как в браузере (с cookie-банкой) ==="
rm -f /tmp/jar.txt
TOKEN=$(curl -s --max-time 20 -X POST http://127.0.0.1:9000/auth/user/emailpass -H 'Content-Type: application/json' -d '{"email":"admin@narazborku.ru","password":"Nb2026-7aa4e8"}' | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))")
echo "    токен: ${#TOKEN} символов"
echo "    заголовок Set-Cookie:"
curl -s -D - -o /dev/null --max-time 20 -c /tmp/jar.txt -X POST http://127.0.0.1:9000/auth/session -H "Authorization: Bearer $TOKEN" -H 'Origin: http://77.233.221.183' | grep -i "set-cookie" | sed 's/^/      /'
echo "    запросы с cookie:"
curl -s -o /dev/null -w "      /admin/users/me → %{http_code}\n" --max-time 20 -b /tmp/jar.txt http://127.0.0.1:9000/admin/users/me
curl -s --max-time 20 -b /tmp/jar.txt "http://127.0.0.1:9000/admin/products?limit=1" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('      /admin/products  → товаров видно:', d.get('count'))" 2>&1 | tail -2
