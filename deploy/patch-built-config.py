#!/usr/bin/env python3
"""
Правка собранного конфига Medusa (.medusa/server/medusa-config.js) без пересборки:
добавляет ограничение пула соединений к PostgreSQL. Нужно на серверах с малой памятью,
где сборка занимает много времени. Для будущих сборок та же настройка уже есть в
исходном medusa-config.ts.
"""
import pathlib
import sys

path = pathlib.Path("/srv/narazborku/app/apps/backend/.medusa/server/medusa-config.js")
src = path.read_text()

if "databaseDriverOptions" in src:
    print("уже настроено — ничего не меняю")
    sys.exit(0)

anchor = "redisUrl: process.env.REDIS_URL,"
block = anchor + """
        databaseDriverOptions: {
            pool: {
                min: Number(process.env.DB_POOL_MIN || 1),
                max: Number(process.env.DB_POOL_MAX || 4),
                idleTimeoutMillis: 30000,
            },
        },"""

if anchor not in src:
    print("НЕ НАЙДЕН якорь в конфиге — правлю вручную:")
    print(src[:800])
    sys.exit(1)

src = src.replace(anchor, block, 1)
path.write_text(src)
print("✔ конфиг обновлён: пул соединений ограничен (min 1, max 4)")
