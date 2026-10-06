#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Приведение каталога ТЕСТОВОГО стенда в порядок (запускать из любой машины —
# нужен только адрес стенда и логин администратора, SSH не требуется).
#
# Что делает:
#   1) проставляет профиль доставки товарам витрины (без него заказ не оформляется —
#      Medusa отвечает «The cart items require shipping profiles…»);
#   2) приводит цены к копейкам, как на боевом магазине (на стенде они были в 100 раз меньше).
#
# Запуск:  bash deploy/fix-stage-catalog.sh
# ---------------------------------------------------------------------------
set -euo pipefail
SHOP="${SHOP:-https://test.77-233-221-183.sslip.io}"
EMAIL="${ADMIN_EMAIL:-prodjectmen@gmail.com}"
PASS="${ADMIN_PASS:-Nb2026-7aa4e8}"
PROFILE_ID="${PROFILE_ID:-sp_01M48YVM51ZTT6N5MEBPM10MSN}"

SHOP="$SHOP" EMAIL="$EMAIL" PASS="$PASS" PROFILE_ID="$PROFILE_ID" python3 - <<'PY'
import json, os, urllib.request
SHOP=os.environ['SHOP']; EMAIL=os.environ['EMAIL']; PASS=os.environ['PASS']; SP=os.environ['PROFILE_ID']
def call(m, p, b=None, jwt=None):
    r = urllib.request.Request(SHOP + p, data=(json.dumps(b).encode() if b is not None else None), method=m)
    r.add_header('Content-Type', 'application/json')
    if jwt: r.add_header('Authorization', 'Bearer ' + jwt)
    try:
        with urllib.request.urlopen(r, timeout=40) as x: return x.status, json.loads(x.read().decode() or '{}')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read().decode() or '{}')

st, tok = call('POST', '/auth/user/emailpass', {'email': EMAIL, 'password': PASS})
if st != 200: raise SystemExit('не удалось войти администратором: %s' % st)
JWT = tok['token']

st, d = call('GET', '/admin/products?limit=100', jwt=JWT)
n_prof = n_price = 0
for p in d.get('products', []):
    if p.get('handle') == 'landing-content':      # служебная страница баннеров, как на боевом
        continue
    st, full = call('GET', '/admin/products/%s?fields=id,title,*shipping_profile,*variants.sku' % p['id'], jwt=JWT)
    prod = full.get('product', {})
    if not (prod.get('shipping_profile') or {}).get('id'):
        st, _ = call('POST', '/admin/products/%s' % p['id'], {'shipping_profile_id': SP}, jwt=JWT)
        if st == 200: n_prof += 1
    for v in (prod.get('variants') or []):
        st, vd = call('GET', '/admin/products/%s/variants/%s?fields=id,sku,*prices' % (p['id'], v['id']), jwt=JWT)
        rub = [x for x in (vd.get('variant', {}).get('prices') or []) if x.get('currency_code') == 'rub']
        if not rub: continue
        amount = rub[0]['amount']
        if amount >= 20000:      # уже похоже на настоящую цену
            continue
        st, _ = call('POST', '/admin/products/%s/variants/%s' % (p['id'], v['id']),
                     {'prices': [{'amount': amount * 100, 'currency_code': 'rub'}]}, jwt=JWT)
        if st == 200: n_price += 1
print('профиль доставки проставлен товарам: %d' % n_prof)
print('цены приведены к копейкам, вариантов: %d' % n_price)
PY
