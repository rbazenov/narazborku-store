#!/bin/bash
# ---------------------------------------------------------------------------
# Включает адрес магазина shop.finklass.online.
# Запускать ПОСЛЕ появления DNS-записи (A, shop → 77.233.221.183):
#     bash /root/enable-shop-subdomain.sh
#
# Что делает:
#   1. проверяет, что домен уже указывает на этот сервер;
#   2. прописывает поддомен в nginx;
#   3. выпускает бесплатный сертификат Let's Encrypt (+ переадресация на https);
#   4. переводит админку и API магазина на новый адрес;
#   5. проверяет магазин снаружи по HTTPS.
# ---------------------------------------------------------------------------
set -u
DOMAIN=shop.finklass.online
IP=77.233.221.183
ENV=/srv/narazborku/app/apps/backend/.env
S=/srv/narazborku/app/apps/backend/.medusa/server
PORT=9000

echo "=== 1. проверяю DNS ==="
RESOLVED=""
for i in $(seq 1 30); do
  RESOLVED=$(getent hosts $DOMAIN | awk '{print $1}' | head -1)
  [ "$RESOLVED" = "$IP" ] && break
  echo "   ждём запись: сейчас «${RESOLVED:-нет}»"
  sleep 10
done
if [ "$RESOLVED" != "$IP" ]; then
  echo "   ✖ домен $DOMAIN не указывает на $IP."
  echo "     Добавьте запись: тип A, имя shop, значение $IP (панель DNS домена finklass.online),"
  echo "     затем запустите этот скрипт снова."
  exit 1
fi
echo "   ✔ $DOMAIN → $RESOLVED"

echo "=== 2. настройка nginx ==="
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
nginx -t && systemctl reload nginx && echo "   ✔ nginx перезапущен"

echo "=== 3. выпуск сертификата ==="
certbot --nginx -d $DOMAIN --agree-tos -m admin@narazborku.ru --non-interactive --redirect 2>&1 | tail -5

echo "=== 4. перевожу магазин на новый адрес ==="
cp $ENV /root/env.bak-sub-$(date +%H%M)
python3 - <<'PY'
import pathlib
p = pathlib.Path("/srv/narazborku/app/apps/backend/.env")
NEW = {"MEDUSA_BACKEND_URL": "https://shop.finklass.online",
       "ADMIN_CORS": "https://shop.finklass.online,https://shop.narazborku.ru",
       "SESSION_COOKIE_SECURE": "true"}
out = []
for line in p.read_text().splitlines():
    key = line.split("=", 1)[0] if "=" in line else ""
    if key in NEW:
        out.append(key + "=" + NEW.pop(key))
    else:
        out.append(line)
for k, v in NEW.items():
    out.append(k + "=" + v)
p.write_text("\n".join(out) + "\n")
for line in out:
    if line.startswith(("MEDUSA_BACKEND_URL=", "ADMIN_CORS=", "SESSION_COOKIE_SECURE=")):
        print("   " + line[:120])
PY
chown medusa:medusa $ENV; chmod 600 $ENV

echo "=== 5. сборка админки под новый адрес (в бандл вшит адрес API) ==="
sudo -u medusa bash -lc "cd $S/public/admin/assets && for f in index-*.js; do
  case \"\$f\" in *.orig) continue;; esac
  sed -i 's#http://77\\.233\\.221\\.183#https://shop.finklass.online#g' \$f
done" && echo "   ✔ адрес в админке обновлён"

systemctl restart narazborku
for i in $(seq 1 25); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:$PORT/health)" = "200" ] && break
  sleep 3
done

echo "=== 6. проверка снаружи ==="
curl -s -o /dev/null -w "   https://$DOMAIN/health → %{http_code}\n" --max-time 30 https://$DOMAIN/health
curl -s -o /dev/null -w "   https://$DOMAIN/app    → %{http_code}\n" --max-time 30 https://$DOMAIN/app
PK=$(sudo -u postgres psql -d narazborku_store -tAc "select token from api_key where type='publishable' limit 1" | tr -d ' ')
curl -s --max-time 30 "https://$DOMAIN/store/products?limit=3" -H "x-publishable-api-key: $PK" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('   витрина отдаёт товаров:', len(d.get('products', [])))" 2>/dev/null
echo
echo "ГОТОВО. Магазин: https://$DOMAIN | Админка: https://$DOMAIN/app"
