#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Настройка ТЕСТОВОГО стенда магазина: ключ для лендинга, витрина, доставка.
# Работает только со стендом (test.77-233-221-183.sslip.io).
#
# Запуск:  bash /root/stage-shop-config.sh
# ---------------------------------------------------------------------------
set -u
BASE=https://test.77-233-221-183.sslip.io
ADMIN_EMAIL=prodjectmen@gmail.com
ADMIN_PASS=Nb2026-7aa4e8
J=/tmp/stage-adm.jar
rm -f $J

AUTH=""
post() { curl -s --max-time 60 -H "$AUTH" -X POST "$BASE/admin/$1" -H 'Content-Type: application/json' -d "$2"; }
get()  { curl -s --max-time 60 -H "$AUTH" "$BASE/admin/$1"; }

echo "== 1. вход в админку стенда =="
TOKEN=$(curl -s --max-time 40 -X POST "$BASE/auth/user/emailpass" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))")
[ -n "$TOKEN" ] || { echo "   не удалось войти"; exit 1; }
AUTH="Authorization: Bearer $TOKEN"
echo "   вошли; проверка доступа: $(get "sales-channels?limit=1" | head -c 60)…"

echo
echo "== 2. канал продаж =="
CHANNEL=$(get "sales-channels?limit=5" | python3 -c "
import sys,json
d=json.load(sys.stdin)
sc=(d.get('sales_channels') or [])
print(sc[0]['id'] if sc else '')")
echo "   канал: $CHANNEL"

echo
echo "== 3. ключ для лендинга =="
KEYJSON=$(post "api-keys" "{\"title\":\"Витрина лендинга (стенд)\",\"type\":\"publishable\"}")
KEYID=$(echo "$KEYJSON" | python3 -c "import sys,json;print((json.load(sys.stdin).get('api_key') or {}).get('id',''))")
KEY=$(echo "$KEYJSON" | python3 -c "import sys,json;print((json.load(sys.stdin).get('api_key') or {}).get('token',''))")
if [ -z "$KEY" ]; then
  echo "   ключ не создан, ищу существующий"
  KEYID=$(get "api-keys?type=publishable&limit=5" | python3 -c "
import sys,json
ks=json.load(sys.stdin).get('api_keys') or []
print(ks[0]['id'] if ks else '')")
  KEY=$(get "api-keys/$KEYID" | python3 -c "import sys,json;print((json.load(sys.stdin).get('api_key') or {}).get('token',''))")
fi
echo "   ключ: $KEY"
post "api-keys/$KEYID/sales-channels" "{\"add\":[\"$CHANNEL\"],\"remove\":[]}" >/dev/null
echo "   ключ привязан к каналу продаж"

echo
echo "== 4. регион и оплата =="
get "regions?limit=5&fields=*payment_providers,*countries" | python3 -c "
import sys,json
for r in json.load(sys.stdin).get('regions',[]):
    print('   регион:', r['name'], r['id'], '| страны:', [c['iso_2'] for c in (r.get('countries') or [])], '| оплата:', [p['id'] for p in (r.get('payment_providers') or [])])"

echo
echo "== 5. профиль доставки и набор выполнения =="
PROFILE=$(get "shipping-profiles?limit=5" | python3 -c "
import sys,json
p=json.load(sys.stdin).get('shipping_profiles') or []
print(p[0]['id'] if p else '')")
echo "   профиль: $PROFILE"
FSET=$(get "fulfillment-sets?limit=5&fields=*service_zones" | python3 -c "
import sys,json
f=json.load(sys.stdin).get('fulfillment_sets') or []
print(f[0]['id'] if f else '')")
echo "   набор выполнения: $FSET"
ZONE=$(get "fulfillment-sets?limit=5&fields=*service_zones" | python3 -c "
import sys,json
for f in json.load(sys.stdin).get('fulfillment_sets',[]):
    for z in (f.get('service_zones') or []):
        if 'Росс' in (z.get('name') or ''): print(z['id'])")
if [ -z "$ZONE" ] && [ -n "$FSET" ]; then
  ZONE=$(post "fulfillment-sets/$FSET/service-zones" '{"name":"Россия","geo_zones":[{"type":"country","country_code":"ru"}]}' \
    | python3 -c "import sys,json;print((json.load(sys.stdin).get('service_zone') or {}).get('id',''))")
  echo "   зона «Россия» создана: $ZONE"
else
  echo "   зона: ${ZONE:-нет}"
fi

echo
echo "== 6. способ доставки (450 ₽) =="
if [ -n "$ZONE" ]; then
  post "shipping-options" "{
    \"name\":\"Доставка по России\",
    \"service_zone_id\":\"$ZONE\",
    \"shipping_profile_id\":\"$PROFILE\",
    \"provider_id\":\"manual_manual\",
    \"price_type\":\"flat\",
    \"prices\":[{\"currency_code\":\"rub\",\"amount\":450}],
    \"rules\":[
      {\"attribute\":\"enabled_in_store\",\"operator\":\"eq\",\"value\":\"true\"},
      {\"attribute\":\"is_return\",\"operator\":\"eq\",\"value\":\"false\"}
    ]
  }" | python3 -c "
import sys,json
d=json.load(sys.stdin)
o=(d.get('shipping_option') or {})
print('   способ доставки:', o.get('name'), o.get('id'), '| цены:', [(p.get('amount')) for p in (o.get('prices') or [])]) if o.get('id') else print('   ответ:', json.dumps(d)[:300])"
fi

echo
echo "== 7. витрина лендинга =="
COLL=$(post "collections" '{"title":"Витрина лендинга","handle":"vitrina-lendinga"}' \
  | python3 -c "import sys,json;print((json.load(sys.stdin).get('collection') or {}).get('id',''))")
if [ -z "$COLL" ]; then
  COLL=$(get "collections?limit=10" | python3 -c "
import sys,json
for c in json.load(sys.stdin).get('collections',[]):
    if c.get('handle') == 'vitrina-lendinga' or 'итрина' in (c.get('title') or ''): print(c['id'])")
fi
echo "   коллекция: $COLL"
IDS=$(get "products?limit=100&fields=id,title" | python3 -c "
import sys,json
ps=[p['id'] for p in json.load(sys.stdin).get('products',[]) if 'баннер' not in (p.get('title') or '').lower()]
print(json.dumps(ps))")
post "collections/$COLL/products" "{\"add\":$IDS}" >/dev/null
echo "   товаров в витрине: $(echo "$IDS" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))')"

echo
echo "== 8. проверка витрины глазами лендинга =="
curl -s --max-time 40 "$BASE/store/products?limit=100&collection_id=$COLL" -H "x-publishable-api-key: $KEY" \
 | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('   товаров видно:', len(d.get('products',[])))"

echo
echo "ИТОГ"
echo "   адрес стенда: $BASE"
echo "   ключ лендинга (стенд): $KEY"
echo "   коллекция витрины: $COLL"
