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
     * Ограничение пула соединений к PostgreSQL.
     * Каждый модуль Medusa держит собственный пул: со стандартным максимумом (10)
     * на 30+ модулей получается 500+ соединений — это перебор для небольшого сервера.
     */
    databaseDriverOptions: {
      pool: {
        min: Number(process.env.DB_POOL_MIN ?? 1),
        max: Number(process.env.DB_POOL_MAX ?? 4),
        idleTimeoutMillis: 30000,
      },
    },
    /**
     * Cookie сессии админки.
     *
     * Medusa в продакшене ставит флаг `Secure`, и браузер отбрасывает такую cookie,
     * если сайт открыт по http:// — вход проходит, но сразу же приходит 401 и панель
     * показывает ошибку. Пока не выпущен HTTPS, задаём SESSION_COOKIE_SECURE=false;
     * после подключения сертификата переменную нужно убрать (или поставить true).
     */
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.SESSION_COOKIE_SECURE !== 'false',
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
