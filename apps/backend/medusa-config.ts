import { loadEnv, defineConfig } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

/**
 * Конфигурация «НаРазборку» (Medusa v2).
 *
 * Всё, что отличается между локальной разработкой и продакшеном на VPS,
 * задаётся переменными окружения — сам файл менять не нужно:
 *   MEDUSA_WORKER_MODE   shared (по умолчанию) | server | worker
 *   DISABLE_MEDUSA_ADMIN true в worker-процессе, чтобы не собирать админку дважды
 *   MEDUSA_BACKEND_URL   публичный URL магазина (напр. https://shop.finklass.online)
 *   REDIS_URL            адрес Redis (в продакшене обязателен)
 *   SESSION_COOKIE_SECURE false — выключить защищённую куку (только для http)
 *   DB_POOL_MIN / DB_POOL_MAX — размер пула подключений к базе
 */
module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    workerMode: (process.env.MEDUSA_WORKER_MODE as 'shared' | 'server' | 'worker') || 'shared',
    databaseDriverOptions: {
      pool: {
        min: Number(process.env.DB_POOL_MIN || 1),
        max: Number(process.env.DB_POOL_MAX || 4),
        idleTimeoutMillis: 30000,
      },
    } as any,
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.SESSION_COOKIE_SECURE !== 'false',
    } as any,
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
  modules: [
    {
      // Загруженные картинки должны отдаваться по адресу магазина,
      // а не по внутреннему http://localhost:9000 (см. deploy/fix-upload-urls.sh)
      resolve: '@medusajs/file',
      options: {
        providers: [
          {
            resolve: '@medusajs/file-local',
            id: 'local',
            options: {
              backend_url: `${process.env.MEDUSA_BACKEND_URL || 'https://shop.finklass.online'}/static`,
            },
          },
        ],
      },
    },
    {
      // Переписка покупателей с продавцом (карточка товара, кабинет, админка)
      resolve: './src/modules/messages',
      options: {},
    },
    {
      // Товары партнёров-авторазборок по фид-ссылкам (сборщик + справочник, см. src/modules/partners)
      resolve: './src/modules/partners',
      options: {},
    },
  ],
})
