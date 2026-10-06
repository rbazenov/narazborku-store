#!/bin/bash
# ---------------------------------------------------------------------------
# HTTPS для магазина на время, пока нет записи shop.finklass.online.
#
# Используется публичный сервис sslip.io: адрес вида 77-233-221-183.sslip.io
# автоматически указывает на 77.233.221.183. Это даёт настоящий сертификат
# Let's Encrypt и работу по https — лендинг сразу получает данные магазина.
#
# Когда появится shop.finklass.online — запускается enable-shop-subdomain.sh,
# лендинг переключится на красивый адрес автоматически (он пробует адреса по порядку).
# ---------------------------------------------------------------------------
set -u
HOSTNAME_ALT=77-233-221-183.sslip.io

echo "=== 1. проверяю, что адрес указывает на этот сервер ==="
RESOLVED=$(getent hosts $HOSTNAME_ALT | awk '{print $1}' | head -1)
echo "   $HOSTNAME_ALT → ${RESOLVED:-не резолвится}"
if [ "$RESOLVED" != "77.233.221.183" ]; then
  echo "   ✖ адрес не указывает на сервер — настройка невозможна"
  exit 1
fi

echo "=== 2. добавляю адрес в nginx ==="
cat > /etc/nginx/sites-available/narazborku-alt <<NGINX
server {
    listen 80;
    server_name $HOSTNAME_ALT;

    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:9000;
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
ln -sf /etc/nginx/sites-available/narazborku-alt /etc/nginx/sites-enabled/narazborku-alt
nginx -t 2>&1 | tail -1 && systemctl reload nginx && echo "   ✔ nginx обновлён"

echo "=== 3. выпускаю сертификат ==="
certbot --nginx -d $HOSTNAME_ALT --agree-tos -m admin@narazborku.ru --non-interactive --redirect 2>&1 | tail -6

echo "=== 4. проверка ==="
curl -s -o /dev/null -w "   https://$HOSTNAME_ALT/health → %{http_code}\n" --max-time 30 https://$HOSTNAME_ALT/health
PK=$(sudo -u postgres psql -d narazborku_store -tAc "select token from api_key where type='publishable' limit 1" | tr -d ' ')
curl -s --max-time 30 "https://$HOSTNAME_ALT/store/products?limit=3" -H "x-publishable-api-key: $PK" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('   витрина отдаёт товаров:', len(d.get('products', [])))" 2>/dev/null
echo "   срок сертификата: $(certbot certificates 2>/dev/null | grep -A1 "$HOSTNAME_ALT" | grep Expiry | sed 's/.*Expiry Date: //' | cut -d' ' -f1-3)"
