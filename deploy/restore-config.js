"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("@medusajs/framework/utils");
(0, utils_1.loadEnv)(process.env.NODE_ENV || 'development', process.cwd());
/**
 * Конфигурация «НаРазборку» (Medusa v2) — собранная версия.
 * Источник: apps/backend/medusa-config.ts
 */
module.exports = (0, utils_1.defineConfig)({
    projectConfig: {
        databaseUrl: process.env.DATABASE_URL,
        redisUrl: process.env.REDIS_URL,
        workerMode: process.env.MEDUSA_WORKER_MODE || 'shared',
        http: {
            storeCors: process.env.STORE_CORS,
            adminCors: process.env.ADMIN_CORS,
            authCors: process.env.AUTH_CORS,
            jwtSecret: process.env.JWT_SECRET,
            cookieSecret: process.env.COOKIE_SECRET,
        },
    },
    admin: {
        backendUrl: process.env.MEDUSA_BACKEND_URL,
        disable: process.env.DISABLE_MEDUSA_ADMIN === 'true',
    },
});
