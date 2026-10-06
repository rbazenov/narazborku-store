#!/bin/bash
set -u
PROFILE=sp_01M487WDGFS7357SKS3ZAAWTFG
echo "=== образец существующей связи ==="
sudo -u postgres psql -d narazborku_store -tAc "select id, product_id from product_shipping_profile limit 1;"
echo ""
echo "=== проставляю профиль всем товарам без него ==="
sudo -u postgres psql -d narazborku_store -q -c "
INSERT INTO product_shipping_profile (product_id, shipping_profile_id, id, created_at, updated_at)
SELECT p.id, '$PROFILE',
       'prodsp_' || upper(substr(md5(random()::text || p.id), 1, 26)),
       now(), now()
FROM product p
LEFT JOIN product_shipping_profile psp ON psp.product_id = p.id AND psp.deleted_at IS NULL
WHERE p.deleted_at IS NULL AND psp.product_id IS NULL;"
sudo -u postgres psql -d narazborku_store -c "select count(*) as товаров_с_профилем from product_shipping_profile where deleted_at is null;" | head -4
