#!/bin/bash
# ---------------------------------------------------------------------------
# Включает магазин на адресе shop.finklass.online.
# Запускать, когда DNS-запись уже есть:  bash /root/enable-shop-subdomain.sh
#
# Что делает:
#   1. дожидается, пока домен начнёт указывать на этот сервер;
#   2. прописывает поддомен в nginx;
#   3. выпускает сертификат Let's Encrypt (+ переадресация на https);
#   4. переводит админку и API на новый адрес (существующие адреса сохраняются);
#   5. пересобирает адрес API внутри админки;
#   6. проверяет работу снаружи.
# ---------------------------------------------------------------------------
set -u
DOMAIN=shop.finklass.online
IP=77.233.221.183
ENV=/srv/narazborku/app/apps/backend/.env
S=/srv/narazborku/app/apps/backend/.medusa/server
PORT=9000

echo "=== 1. ждём, пока домен начнёт указывать на этот сервер ==="
resolvectl flush-caches 2>/dev/null || systemd-resolve --flush-caches 2>/dev/null || true
RESOLVED=""
for i in $(seq 1 30); do
  RESOLVED=$(getent hosts $DOMAIN | awk '{print $1}' | head -1)
  [ "$RESOLVED" = "$IP" ] && break
  echo "   сейчас «${RESOLVED:-нет}» — ждём (попытка $i)"
  sleep 10
done
if [ "$RESOLVED" != "$IP" ]; then
  echo "   ✖ домен $DOMAIN пока не указывает на $IP — запустите скрипт позже"
  exit 1
fi
echo "   ✔ $DOMAIN → $RESOLVED"

echo "=== 2. nginx ==="
cat > /etc/nginx/sites-available/narazborku-shop <<NGINX
server {
    listen 80;
    server_name $DOMAIN;

    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/narazborku-shop /etc/nginx/sites-enabled/narazborku-shop
nginx -t 2>&1 | tail -1 && systemctl reload nginx && echo "   ✔ nginx перечитан"

echo "=== 3. сертификат ==="
certbot --nginx -d $DOMAIN --agree-tos -m admin@narazborku.ru --non-interactive --redirect 2>&1 | grep -E "Successfully|Certificate is saved|Deploying|error|Error" | head -5

echo "=== 4. адреса магазина ==="
cp $ENV /root/env.bak-sub-$(date +%H%M)
python3 - <<'PY'
import pathlib
p = pathlib.Path("/srv/narazborku/app/apps/backend/.env")
NEW = ["https://shop.finklass.online", "https://finklass.online"]
SET = {"MEDUSA_BACKEND_URL": "https://shop.finklass.online", "SESSION_COOKIE_SECURE": "true"}
out = []
for line in p.read_text().splitlines():
    key = line.split("=", 1)[0] if "=" in line else ""
    if key in SET:
        out.append(key + "=" + SET.pop(key))
    elif key in ("STORE_CORS", "AUTH_CORS", "ADMIN_CORS"):
        vals = [v for v in line.split("=", 1)[1].split(",") if v]
        for n in NEW:
            if n not in vals:
                vals.append(n)
        out.append(key + "=" + ",".join(vals))
    else:
        out.append(line)
for k, v in SET.items():
    out.append(k + "=" + v)
p.write_text("\n".join(out) + "\n")
for line in out:
    if line.startswith(("MEDUSA_BACKEND_URL=", "ADMIN_CORS=", "SESSION_COOKIE_SECURE=")):
        print("   " + line[:150])
PY
chown medusa:medusa $ENV; chmod 600 $ENV

echo "=== 5. адрес API внутри админки ==="
sudo -u medusa bash -lc "cd $S/public/admin/assets && for f in index-*.js; do
  case \"\$f\" in *.orig) continue;; esac
  sed -i 's#http://77\\.233\\.221\\.183#https://$DOMAIN#g' \$f
done" && echo "   ✔ обновлён"

systemctl restart narazborku
for i in $(seq 1 25); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:$PORT/health)" = "200" ] && break
  sleep 3
done
echo "   локальная проверка: $(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:$PORT/health)"

echo "=== 6. проверка снаружи ==="
curl -s -o /dev/null -w "   https://$DOMAIN/health → %{http_code}\n" --max-time 30 https://$DOMAIN/health
curl -s -o /dev/null -w "   https://$DOMAIN/app    → %{http_code}\n" --max-time 30 https://$DOMAIN/app
PK=$(sudo -u postgres psql -d narazborku_store -tAc "select token from api_key where type='publishable' limit 1" | tr -d ' ')
curl -s --max-time 30 "https://$DOMAIN/store/products?limit=3" -H "x-publishable-api-key: $PK" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('   витрина отдаёт товаров:', len(d.get('products', [])))" 2>/dev/null
curl -s -D - -o /dev/null --max-time 20 "https://$DOMAIN/store/regions" -H "Origin: https://finklass.online" -H "x-publishable-api-key: $PK" | grep -i "access-control-allow-origin" | sed 's/^/   CORS: /'
echo
echo "ГОТОВО: https://$DOMAIN | админка https://$DOMAIN/app"
