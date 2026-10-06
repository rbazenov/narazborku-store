import { loadEnv, defineConfig } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

/**
 * Конфигурация «НаРазборку» (Medusa v2).
 *
 * Всё, что отличается между локальной разработкой и продакшеном на VPS,
 * задаётся переменными окружения — сам файл менять не нужно:
 *   MEDUSA_WORKER_MODE   shared (по умолчанию) | server | worker
 *   DISABLE_MEDUSA_ADMIN true в worker-процессе, чтобы не собирать админку дважды
 *   MEDUSA_BACKEND_URL   публичный URL магазина (напр. https://shop.narazborku.ru)
 *   REDIS_URL            адрес Redis (в продакшене обязателен)
 */
module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    workerMode: (process.env.MEDUSA_WORKER_MODE as 'shared' | 'server' | 'worker') || 'shared',
    /**
     * Каждый модуль Medusa держит собственный пул соединений к PostgreSQL.
     * Со стандартным максимумом (10) 20+ модулей открывают 200–250 соединений —
     * для небольшого сервера это перебор и ошибка «too many clients».
     * Ограничиваем пул: важно на серверах с 2–4 ГБ памяти.
     */
    databaseDriverOptions: {
      pool: {
        // min 0 — соединения открываются по требованию и закрываются после простоя:
        // на сервере с 2 ГБ памяти это экономит сотни мегабайт
        min: Number(process.env.DB_POOL_MIN ?? 0),
        max: Number(process.env.DB_POOL_MAX ?? 3),
        idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_MS ?? 10000),
      },
    },
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
    },
  },
  admin: {
    // Публичный адрес API: нужен, когда панель и API живут за одним доменом или за прокси
    backendUrl: process.env.MEDUSA_BACKEND_URL,
    // В worker-процессе админку отдавать не нужно
    disable: process.env.DISABLE_MEDUSA_ADMIN === 'true',
  },
})
