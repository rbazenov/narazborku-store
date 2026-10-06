#!/usr/bin/env node
/* ---------------------------------------------------------------------------
   Заводит в магазин товары, которые уже показаны на витрине лендинга.
   
   Зачем: витрина показывает каталог страницы (58 товаров), а магазин знает только
   часть из них. Заказ собирается из товаров магазина, поэтому для остальных
   «Подтвердить заказ» ничего не заказывал — корзина оставалась, в кабинете заказ
   не появлялся. Этот скрипт досоздаёт недостающие товары: с ценой, складом,
   категорией и профилем доставки — после него витрина полностью заказываема.

   Идемпотентно: товары с уже существующим артикулом не трогаются.

   Запуск (по умолчанию — тестовый стенд):
     node add-showcase-products.js                # стенд
     SHOP=https://shop.finklass.online node add-showcase-products.js   # боевой
     DRY=1 node add-showcase-products.js          # только показать, что будет создано
--------------------------------------------------------------------------- */
const fs = require('fs');
const path = require('path');

const SHOP = process.env.SHOP || 'https://test.77-233-221-183.sslip.io';
const EMAIL = process.env.ADMIN_EMAIL || 'prodjectmen@gmail.com';
const PASS = process.env.ADMIN_PASS || 'Nb2026-7aa4e8';
const QTY = Number(process.env.QTY || 100);
const DRY = !!process.env.DRY;
const CATALOG = process.env.CATALOG || path.join(__dirname, 'landing-catalog.json');

const log = (...a) => console.log(...a);
let created = 0, skipped = 0, failed = 0;

async function api(pathname, opts = {}) {
  const r = await fetch(SHOP + pathname, {
    method: opts.method || 'GET',
    headers: Object.assign({ Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, opts.headers || {}),
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await r.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text.slice(0, 200) }; }
  if (!r.ok) { const err = new Error((data && (data.message || data.raw)) || ('код ' + r.status)); err.status = r.status; err.data = data; throw err; }
  return data;
}

let TOKEN = '';

(async () => {
  const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  log('магазин: ' + SHOP);
  log('каталог витрины: ' + catalog.length + ' товаров (' + CATALOG + ')');

  const auth = await fetch(SHOP + '/auth/user/emailpass', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASS }) }).then(r => r.json());
  TOKEN = auth.token;
  if (!TOKEN) { log('не удалось войти в админку'); process.exit(1); }

  /* что уже есть в магазине */
  const prods = await api('/admin/products?limit=200&fields=id,title,*variants');
  const haveSku = new Set();
  for (const p of prods.products || []) for (const v of p.variants || []) if (v.sku) haveSku.add(String(v.sku));
  log('в магазине товаров: ' + (prods.products || []).length + ', артикулов: ' + haveSku.size);

  const regions = await api('/admin/regions?limit=20');
  const region = (regions.regions || []).find(r => r.currency_code === 'rub') || (regions.regions || [])[0];
  if (!region) { log('в магазине нет региона с рублями'); process.exit(1); }
  log('регион: ' + region.name + ' (' + region.currency_code + ')');

  const cats = await api('/admin/product-categories?limit=200');
  const catId = new Map((cats.product_categories || []).map(c => [c.name, c.id]));

  const locs = await api('/admin/stock-locations?limit=10');
  const loc = (locs.stock_locations || [])[0];
  if (!loc) { log('в магазине нет склада'); process.exit(1); }
  log('склад: ' + loc.name + ' (' + loc.id + ')');

  /* профиль доставки: берём тот, что уже стоит у товаров витрины */
  const withProfile = await api('/admin/products?limit=200&fields=id,shipping_profile.id');
  const profileId = ((withProfile.products || []).find(p => (p.shipping_profile || {}).id) || {}).shipping_profile.id;
  if (!profileId) { log('не нашёл профиль доставки у товаров магазина'); process.exit(1); }
  log('профиль доставки: ' + profileId);

  const missing = catalog.filter(it => !haveSku.has(String(it.sku)));
  log('\nне хватает товаров: ' + missing.length + (DRY ? '  (режим показа, ничего не создаём)' : ''));

  for (const it of missing) {
    const sku = String(it.sku);
    try {
      /* категория */
      let cid = catId.get(it.cat);
      if (!cid && !DRY) {
        const nc = await api('/admin/product-categories', { method: 'POST', body: { name: it.cat, is_active: true, is_internal: false } });
        cid = nc.product_category.id; catId.set(it.cat, cid);
        log('   + категория «' + it.cat + '»');
      }
      if (DRY) { log('   создать: ' + sku + ' · ' + it.title + ' · ' + it.price + ' ₽ · ' + it.cat); created++; continue; }

      const np = await api('/admin/products', {
        method: 'POST',
        body: {
          title: it.title,
          status: 'published',
          description: (it.brand ? it.brand + '. ' : '') + 'Артикул ' + sku + '.',
          shipping_profile_id: profileId,
          metadata: { brand: it.brand || '', landing_sku: sku },
          options: [{ title: 'Артикул', values: [sku] }],
          variants: [{
            title: sku, sku: sku, manage_inventory: true, allow_backorder: false,
            options: { 'Артикул': sku },
            prices: [{ amount: Math.round(it.price * 100), currency_code: region.currency_code }],
          }],
        },
      });
      const product = np.product;
      const variant = (product.variants || [])[0] || {};
      if (cid) await api('/admin/products/' + product.id + '/categories', { method: 'POST', body: { add: [cid] } }).catch(() => null);

      /* склад: позиция учёта + остаток */
      const inv = await api('/admin/inventory-items', { method: 'POST', body: { sku: sku, title: it.title, requires_shipping: true } });
      const inventoryItem = inv.inventory_item;
      if (inventoryItem && loc.id) {
        await api('/admin/inventory-items/' + inventoryItem.id + '/location-levels', { method: 'POST', body: { location_id: loc.id, stocked_quantity: QTY } });
      }
      /* связываем вариант с позицией учёта, если магазин не сделал это сам */
      if (inventoryItem && variant.id) {
        await api('/admin/products/' + product.id + '/variants/' + variant.id + '/inventory-items', { method: 'POST', body: { inventory_item_id: inventoryItem.id, required_quantity: 1 } })
          .catch(() => null);
      }
      created++;
      log('   + ' + sku + ' · ' + it.title + ' · ' + it.price + ' ₽ · на складе ' + QTY);
    } catch (e) {
      failed++;
      log('   ! ' + sku + ' · ' + it.title + ' — ' + (e.message || e));
    }
  }

  const after = await api('/admin/products?limit=200&fields=id,*variants');
  const skus = new Set();
  for (const p of after.products || []) for (const v of p.variants || []) if (v.sku) skus.add(String(v.sku));
  const still = catalog.filter(it => !skus.has(String(it.sku)));
  log('\nсоздано: ' + created + ', пропущено (уже есть): ' + (catalog.length - missing.length) + ', ошибок: ' + failed);
  log('теперь заказать можно: ' + (catalog.length - still.length) + ' из ' + catalog.length + ' товаров витрины' + (still.length ? ', без магазина: ' + still.length : ''));
})();
