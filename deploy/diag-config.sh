#!/bin/bash
# Проверка: доходят ли настройки пула из конфига до рантайма
set -u
cd /srv/narazborku/app/apps/backend/.medusa/server

echo "=== 1. что содержит собранный конфиг ==="
node -e "
const c = require('./medusa-config.js');
console.log('databaseDriverOptions:', JSON.stringify(c.projectConfig.databaseDriverOptions));
console.log('ключи projectConfig:', Object.keys(c.projectConfig).join(', '));
"

echo "=== 2. есть ли databaseDriverOptions в схеме валидации ==="
grep -rn "databaseDriverOptions" /srv/narazborku/app/node_modules/@medusajs/framework/dist/config/*.js 2>/dev/null | head -5
grep -rn "databaseDriverOptions" /srv/narazborku/app/node_modules/@medusajs/framework/dist/utils/*.js 2>/dev/null | head -5

echo "=== 3. как валидируется projectConfig (фрагмент схемы) ==="
grep -rn -A20 "projectConfig" /srv/narazborku/app/node_modules/@medusajs/framework/dist/config/config.js 2>/dev/null | grep -E "databaseDriverOptions|pool|z\.|Database" | head -12

echo "=== 4. сколько модулей грузится ==="
grep -rn "modules:" /srv/narazborku/app/apps/backend/.medusa/server/medusa-config.js 2>/dev/null | head -3
node -e "
const { defineConfig } = require('@medusajs/framework/utils');
const cfg = require('./medusa-config.js');
console.log('проверка схемы прошла');
" 2>&1 | tail -3
