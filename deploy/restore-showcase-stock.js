#!/usr/bin/env node
/* ---------------------------------------------------------------------------
   Возвращает склад: создаёт недостающие складские позиции для товаров магазина,
   привязывает их к вариантам и ставит остаток (по умолчанию 100 шт.).

   Нужен, если склад был очищен (например, кнопкой «Удалить выбранные» в разделе
   «Склад»), а товары нужно снова сделать заказываемыми: без складской позиции
   остаток у товара не считается, и он не продаётся.

   Идемпотентно: товарам, у которых позиция уже есть, ничего не меняется.

   Запуск (по умолчанию — тестовый стенд):
     node restore-showcase-stock.js                       # стенд
     SHOP=https://shop.finklass.online node restore-showcase-stock.js   # боевой
     QTY=100 node restore-showcase-stock.js               # другой остаток
--------------------------------------------------------------------------- */
const SHOP = process.env.SHOP || 'https://test.77-233-221-183.sslip.io';
const EMAIL = process.env.ADMIN_EMAIL || 'prodjectmen@gmail.com';
const PASS = process.env.ADMIN_PASS || 'Nb2026-7aa4e8';
const QTY = Number(process.env.QTY || 100);
const log = (...a) => console.log(...a);

let TOKEN = '';
async function api(path, opts = {}) {
  const r = await fetch(SHOP + path, {
    method: opts.method || 'GET',
    headers: Object.assign({ Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, opts.headers || {}),
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await r.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text.slice(0, 200) }; }
  if (!r.ok) { const e = new Error((data && (data.message || data.raw)) || ('код ' + r.status)); e.status = r.status; e.data = data; throw e; }
  return data;
}

(async () => {
  const auth = await fetch(SHOP + '/auth/user/emailpass', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  }).then((r) => r.json());
  TOKEN = auth.token;
  if (!TOKEN) { log('не удалось войти в админку'); process.exit(1); }

  const locs = await api('/admin/stock-locations?limit=10');
  const loc = (locs.stock_locations || [])[0];
  if (!loc) { log('в магазине нет склада'); process.exit(1); }
  log('магазин: ' + SHOP);
  log('склад: ' + loc.name + ' (' + loc.id + '), ставим остаток ' + QTY + ' шт.');

  const prods = (await api('/admin/products?limit=200&fields=id,title,*variants')).products || [];
  log('товаров в магазине: ' + prods.length);

  let restored = 0, linked = 0, levels = 0, already = 0, failed = 0;
  for (const p of prods) {
    for (const v of p.variants || []) {
      const sku = v.sku ? String(v.sku) : '';
      if (!sku) continue;
      try {
        /* есть ли у варианта складская позиция */
        const full = await api('/admin/products/' + p.id + '/variants/' + v.id + '?fields=id,sku,*inventory_items');
        const links = (full.variant && full.variant.inventory_items) || [];
        if (links.length) { already++; continue; }

        let itemId = links.length ? (links[0].inventory_item_id || links[0].id) : null;
        if (!itemId) {
          const ni = await api('/admin/inventory-items', { method: 'POST', body: { sku: sku, title: v.title || sku, requires_shipping: true } });
          itemId = ni.inventory_item.id;
          restored++;
        }
        await api('/admin/products/' + p.id + '/variants/' + v.id + '/inventory-items', {
          method: 'POST', body: { inventory_item_id: itemId, required_quantity: 1 },
        }).then(() => linked++).catch(() => null);
        await api('/admin/inventory-items/' + itemId + '/location-levels', {
          method: 'POST', body: { location_id: loc.id, stocked_quantity: QTY },
        }).then(() => levels++).catch(() => null);
        log('   + ' + sku + ' · ' + (v.title || '') + ' — позиция восстановлена');
      } catch (e) {
        failed++;
        log('   ! ' + sku + ' — ' + (e.message || e));
      }
    }
  }

  /* проверка глазами витрины магазина */
  const keys = (await api('/admin/api-keys?limit=20&type=publishable').catch(() => null)) || {};
  const key = ((keys.api_keys) || []).map((k) => k.token)[0];
  if (key) {
    const r = await fetch(SHOP + '/store/products?limit=200&fields=*variants,+variants.inventory_quantity', { headers: { 'x-publishable-api-key': key } }).then((x) => x.json()).catch(() => null);
    let withStock = 0, total = 0;
    for (const p of (r && r.products) || []) for (const v of p.variants || []) { total++; if (Number(v.inventory_quantity) > 0) withStock++; }
    log('\nвитрина магазина: вариантов ' + total + ', с остатком ' + withStock);
  }

  log('итог: позиций создано ' + restored + ', привязано к вариантам ' + linked + ', уровней склада ' + levels +
      ', уже были на месте ' + already + (failed ? ', ошибок ' + failed : ''));
})();
