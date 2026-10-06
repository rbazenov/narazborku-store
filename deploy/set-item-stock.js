#!/usr/bin/env node
/* ---------------------------------------------------------------------------
   Ставит остаток на складе конкретному товару по артикулу (для проверок и правок).
   Запуск:
     node set-item-stock.js FE-108005 0                 # стенд: товара нет на складе
     node set-item-stock.js FE-108005 100               # стенд: вернуть остаток
     QTY=100 node set-item-stock.js                      # всем товарам витрины
     SHOP=https://shop.finklass.online node set-item-stock.js FE-108005 100
--------------------------------------------------------------------------- */
const fs = require('fs');
const path = require('path');
const SHOP = process.env.SHOP || 'https://test.77-233-221-183.sslip.io';
const EMAIL = process.env.ADMIN_EMAIL || 'prodjectmen@gmail.com';
const PASS = process.env.ADMIN_PASS || 'Nb2026-7aa4e8';
let TOKEN = '';
async function api(pathname, opts = {}) {
  const r = await fetch(SHOP + pathname, {
    method: opts.method || 'GET',
    headers: Object.assign({ Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, opts.headers || {}),
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await r.text(); let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text.slice(0, 200) }; }
  if (!r.ok) { const e = new Error((data && (data.message || data.raw)) || ('код ' + r.status)); e.status = r.status; throw e; }
  return data;
}
(async () => {
  const [skuArg, qtyArg] = process.argv.slice(2);
  const QTY = Number(qtyArg != null ? qtyArg : (process.env.QTY || 0));
  const auth = await fetch(SHOP + '/auth/user/emailpass', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASS }) }).then(r => r.json());
  TOKEN = auth.token;
  if (!TOKEN) { console.log('не удалось войти в админку'); process.exit(1); }
  const locs = await api('/admin/stock-locations?limit=10');
  const loc = (locs.stock_locations || [])[0];
  if (!loc) { console.log('в магазине нет склада'); process.exit(1); }

  let skus = skuArg ? [String(skuArg)] : [];
  if (!skus.length) {
    const catalog = JSON.parse(fs.readFileSync(process.env.CATALOG || path.join(__dirname, 'landing-catalog.json'), 'utf8'));
    skus = catalog.map(x => String(x.sku));
  }
  const items = (await api('/admin/inventory-items?limit=500&fields=id,sku,*location_levels')).inventory_items || [];
  const bySku = new Map(items.filter(i => i.sku).map(i => [String(i.sku), i]));
  let ok = 0, bad = 0;
  for (const sku of skus) {
    const item = bySku.get(sku);
    if (!item) { console.log('  ! ' + sku + ' — нет позиции учёта в магазине'); bad++; continue; }
    const level = (item.location_levels || []).find(l => l.location_id === loc.id);
    try {
      if (level) await api('/admin/inventory-items/' + item.id + '/location-levels/' + loc.id, { method: 'POST', body: { stocked_quantity: QTY } });
      else await api('/admin/inventory-items/' + item.id + '/location-levels', { method: 'POST', body: { location_id: loc.id, stocked_quantity: QTY } });
      ok++;
    } catch (e) { console.log('  ! ' + sku + ' — ' + (e.message || e)); bad++; }
  }
  console.log('остаток ' + QTY + ' шт. выставлен: ' + ok + ' товарам' + (bad ? ', ошибок ' + bad : '') + ' (' + SHOP + ')');
})();
