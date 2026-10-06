#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Чистка тестовых данных магазина «НаРазборку».
#
# Что делает:
#   1. сохраняет резервную копию тестовых таблиц (данные можно вернуть);
#   2. отменяет заказы через API — это освобождает забронированный товар на складе;
#   3. удаляет покупателей через API (вместе с их сессиями входа);
#   4. «мягко» убирает заказы, корзины и оплаты из базы (в админке их больше не видно);
#   5. показывает, что осталось.
#
# Запуск на сервере (админ-пароль — от аккаунта владельца магазина):
#   ADMIN_PASS='...' bash /root/clean-test-data.sh --yes
# Без --yes скрипт ничего не меняет — только показывает, что будет убрано.
#
# Бэкап: /var/backups/narazborku/test-data-<дата>.sql.gz
# ---------------------------------------------------------------------------
set -u

BASE="${BASE:-http://127.0.0.1:9000}"
ADMIN_EMAIL="${ADMIN_EMAIL:-prodjectmen@gmail.com}"
DB="${DB:-narazborku_store}"
COOKIE="$(mktemp)"
TABLES_ORDER=(order order_item order_line_item order_line_item_adjustment order_line_item_tax_line
  order_address order_shipping_method order_shipping_method_adjustment order_shipping_method_tax_line
  order_summary order_cart order_payment_collection order_transaction order_change)
TABLES_CART=(cart cart_line_item cart_address cart_shipping_method cart_payment_collection)
TABLES_PAY=(payment payment_session payment_collection)

q() { sudo -u postgres psql -d "$DB" -tAc "$1"; }
report() {
  sudo -u postgres psql -d "$DB" -c "
  select 'заказы' as т, count(*) from \"order\" where deleted_at is null
  union all select 'корзины', count(*) from cart where deleted_at is null
  union all select 'оплаты', count(*) from payment where deleted_at is null
  union all select 'покупатели', count(*) from customer where deleted_at is null
  union all select 'брони склада', count(*) from reservation_item where deleted_at is null;"
}

echo "== 1. что сейчас в базе =="
report
ORDERS=$(q "select count(*) from \"order\" where deleted_at is null")
CUSTOMERS=$(q "select count(*) from customer where deleted_at is null")
if [ "${ORDERS:-0}" = "0" ] && [ "${CUSTOMERS:-0}" = "0" ]; then
  echo "   данных для уборки нет — база уже чистая"
  exit 0
fi

if [ "${1:-}" != "--yes" ]; then
  echo
  echo "   Заказов: $ORDERS, покупателей: $CUSTOMERS."
  echo "   Запустите с ключом --yes, чтобы убрать их (сначала будет сделана резервная копия)."
  exit 0
fi

echo
echo "== 2. резервная копия =="
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p /var/backups/narazborku
DUMP_ARGS=""
for t in "${TABLES_ORDER[@]}" "${TABLES_CART[@]}" "${TABLES_PAY[@]}" customer auth_identity reservation_item; do
  DUMP_ARGS="$DUMP_ARGS --table=\"$t\""
done
eval "sudo -u postgres pg_dump -d $DB --data-only $DUMP_ARGS" 2>/dev/null \
  | gzip > "/var/backups/narazborku/test-data-$TS.sql.gz"
echo "   /var/backups/narazborku/test-data-$TS.sql.gz ($(du -h /var/backups/narazborku/test-data-$TS.sql.gz | cut -f1))"

echo
echo "== 3. вход в админку =="
if [ -z "${ADMIN_PASS:-}" ]; then
  echo "   Не задан ADMIN_PASS — отмена и удаления покупателей не выполнить." >&2
  exit 1
fi
TOKEN=$(curl -s --max-time 30 -X POST "$BASE/auth/user/emailpass" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))")
if [ -z "$TOKEN" ]; then echo "   не удалось войти ($ADMIN_EMAIL)" >&2; exit 1; fi
curl -s --max-time 30 -c "$COOKIE" -o /dev/null -X POST "$BASE/auth/session" \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{}'
echo "   вошли как $ADMIN_EMAIL"

echo
echo "== 4. отменяю заказы (освобождает склад) =="
curl -s --max-time 30 -b "$COOKIE" "$BASE/admin/orders?limit=100&fields=id,display_id" \
  | python3 -c "
import sys,json
for o in json.load(sys.stdin).get('orders', []): print(o['id'], o['display_id'])" > /tmp/nr-orders.txt
while read -r OID NUM; do
  [ -z "${OID:-}" ] && continue
  curl -s -o /dev/null -w "   заказ №$NUM → %{http_code}\n" --max-time 45 -b "$COOKIE" \
    -X POST "$BASE/admin/orders/$OID/cancel" -H 'Content-Type: application/json' -d '{}'
done < /tmp/nr-orders.txt

echo
echo "== 5. удаляю покупателей =="
curl -s --max-time 30 -b "$COOKIE" "$BASE/admin/customers?limit=200&fields=id,email" \
  | python3 -c "
import sys,json
for c in json.load(sys.stdin).get('customers', []): print(c['id'], c['email'])" > /tmp/nr-custs.txt
while read -r CID MAIL; do
  [ -z "${CID:-}" ] && continue
  curl -s -o /dev/null -w "   $MAIL → %{http_code}\n" --max-time 30 -b "$COOKIE" \
    -X DELETE "$BASE/admin/customers/$CID"
done < /tmp/nr-custs.txt

echo
echo "== 6. убираю заказы, корзины и оплаты из базы =="
SQL="begin;"
for t in "${TABLES_ORDER[@]}" "${TABLES_CART[@]}" "${TABLES_PAY[@]}" customer; do
  SQL="$SQL update \"$t\" set deleted_at = now() where deleted_at is null;"
done
SQL="$SQL update auth_identity a set deleted_at = now() where a.deleted_at is null and a.app_metadata->>'user_id' is null;"
SQL="$SQL commit;"
sudo -u postgres psql -d "$DB" -q -c "$SQL"

echo
echo "== 7. что осталось =="
report
echo
echo "   Резервная копия: /var/backups/narazborku/test-data-$TS.sql.gz"
rm -f "$COOKIE"
