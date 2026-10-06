#!/usr/bin/env node
/* ---------------------------------------------------------------------------
   Проставляет остаток (по умолчанию 100 шт.) на складе для всех товаров витрины.
   
   Зачем: без остатка товар на витрине помечен «закончился», и его нельзя
   оформить онлайн — корзина не обнулится, заказ не появится в кабинете.

   Идемпотентно: существующим позициям учёта остаток перезаписывается.

   Запуск (по умолчанию — тестовый стенд):
     node set-showcase-stock.js                      # стенд
     QTY=100 SHOP=https://shop.finklass.online node set-showcase-stock.js   # боевой
     DRY=1 node set-showcase-stock.js                # только показать
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

let TOKEN = '';
async function api(pathname, opts = {}) {
  const r = await fetch(SHOP + pathname, {
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
  const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  const wantSku = new Set(catalog.map(x => String(x.sku)));
  log('магазин: ' + SHOP + ', ставим остаток: ' + QTY + ' шт.' + (DRY ? ' (показ, ничего не меняем)' : ''));

  const auth = await fetch(SHOP + '/auth/user/emailpass', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASS }) }).then(r => r.json());
  TOKEN = auth.token;
  if (!TOKEN) { log('не удалось войти в админку'); process.exit(1); }

  const locs = await api('/admin/stock-locations?limit=10');
  const loc = (locs.stock_locations || [])[0];
  if (!loc) { log('в магазине нет склада'); process.exit(1); }
  log('склад: ' + loc.name + ' (' + loc.id + ')');

  /* все позиции учёта с их остатками по складам */
  const items = (await api('/admin/inventory-items?limit=500&fields=id,sku,*location_levels')).inventory_items || [];
  const bySku = new Map();
  for (const it of items) if (it.sku) bySku.set(String(it.sku), it);
  log('позиций учёта в магазине: ' + items.length);

  let okLevel = 0, createdLevel = 0, updatedLevel = 0, noItem = 0, failed = 0;
  const missing = [];
  for (const it of catalog) {
    const sku = String(it.sku);
    const item = bySku.get(sku);
    if (!item) { noItem++; missing.push(sku); continue; }
    const level = (item.location_levels || []).find(l => l.location_id === loc.id);
    if (level) okLevel++;
    try {
      if (level) {
        if (Number(level.stocked_quantity) === QTY) continue;
        if (!DRY) await api('/admin/inventory-items/' + item.id + '/location-levels/' + loc.id, { method: 'POST', body: { stocked_quantity: QTY } });
        updatedLevel++;
      } else {
        if (!DRY) await api('/admin/inventory-items/' + item.id + '/location-levels', { method: 'POST', body: { location_id: loc.id, stocked_quantity: QTY } });
        createdLevel++;
      }
    } catch (e) { failed++; log('   ! ' + sku + ' — ' + (e.message || e)); }
  }

  /* проверка через витрину магазина: сколько товаров реально доступно к заказу */
  const pub = await api('/admin/api-keys?limit=20&type=publishable').catch(() => null);
  const key = ((pub && pub.api_keys) || []).map(k => k.token)[0];
  if (key) {
    const r = await fetch(SHOP + '/store/products?limit=200&fields=*variants,+variants.inventory_quantity', { headers: { 'x-publishable-api-key': key } }).then(x => x.json()).catch(() => null);
    const inStock = new Set();
    for (const p of (r && r.products) || []) for (const v of p.variants || []) if (v.sku && Number(v.inventory_quantity) > 0) inStock.add(String(v.sku));
    const canOrder = catalog.filter(x => inStock.has(String(x.sku))).length;
    log('\nпроверка через витрину магазина: заказать можно ' + canOrder + ' из ' + catalog.length + ' товаров витрины');
  }

  log('уровни: уже стояли ' + okLevel + ', создано ' + createdLevel + ', обновлено ' + updatedLevel + ', ошибок ' + failed);
  if (noItem) log('нет позиции учёта у ' + noItem + ' артикулов (сначала node add-showcase-products.js): ' + missing.slice(0, 6).join(', '));
})();
