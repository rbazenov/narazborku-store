#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Пополнение остатков товаров витрины на складе магазина.
#
# Зачем: остатки списываются при оформлении заказов, и после серии тестов
# товар может «закончиться» — витрина покажет «Нет в наличии», а оформление
# заказа вернёт ошибку про склад.
#
# Запуск (нужна действующая админ-сессия магазина):
#   COOKIE=cookies.txt QTY=100 bash topup-stock.sh
# ---------------------------------------------------------------------------
set -euo pipefail

BASE="${BASE:-https://shop.finklass.online}"
COOKIE="${COOKIE:-cookies.txt}"       # файл с cookie админ-сессии (curl -c cookies.txt при входе)
QTY="${QTY:-100}"
SKUS="${SKUS:-MN-W9142 SH-550046344 BS-0986424896 MN-CUK2939 NGK6418 MN-W71295 OS-64210 NGK7558 OS-64193 BS-1987474102}"

echo "== читаю позиции склада =="
curl -s --max-time 30 -b "$COOKIE" "$BASE/admin/inventory-items?limit=100" \
  | python3 -c "
import sys, json
want = set('''$SKUS'''.split())
for it in json.load(sys.stdin).get('inventory_items', []):
    if it.get('sku') in want:
        lv = (it.get('location_levels') or [{}])[0]
        print('%s|%s|%s' % (it['id'], lv.get('location_id'), it['sku']))
" > /tmp/stock-list.txt

echo "== поднимаю остаток до $QTY шт. =="
while IFS='|' read -r iid loc sku; do
  [ -z "${iid:-}" ] && continue
  curl -s --max-time 25 -b "$COOKIE" -X POST \
    "$BASE/admin/inventory-items/$iid/location-levels/$loc" \
    -H 'Content-Type: application/json' -d "{\"stocked_quantity\":$QTY}" \
    -o /tmp/stock-one.json -w "  $sku → код %{http_code}"
  python3 -c "
import json
lv = (json.load(open('/tmp/stock-one.json')).get('inventory_item', {}).get('location_levels') or [{}])[0]
print(', на складе: %s, доступно: %s' % (lv.get('stocked_quantity'), lv.get('available_quantity')))
" 2>/dev/null || echo ""
done < /tmp/stock-list.txt

echo
echo "Внимание: «доступно» меньше складского остатка — значит часть товара держат"
echo "неоплаченные заказы. Освободить можно, отменив заказ или подтвердив оплату."
