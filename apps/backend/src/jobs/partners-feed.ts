import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { runPartnersFetch } from "../modules/partners/fetch"

/**
 * Обновление фидов партнёров по расписанию (по умолчанию — раз в час).
 *
 * Забираем фиды не чаще раза в час: партнёры обновляют свои файлы нечасто,
 * а лишние обращения к чужим сайтам никому не нужны. Если партнёр поправил
 * товар срочно — в админке есть кнопка «Обновить сейчас».
 *
 * Расписание можно изменить переменной окружения PARTNERS_FEED_CRON —
 * например, каждые 30 минут («ноль-дробь-30» в формате cron). Чтобы партнёр
 * вообще не обновлялся, у него снимается галочка «включён».
 */
export default async function partnersFeedJob(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const started = Date.now()
  logger.info("[partners] обновление фидов партнёров: старт")
  try {
    const results = await runPartnersFetch(knex, { log: (m) => logger.info(`[partners] ${m}`) })
    const ok = results.filter((r) => r.status === "ok").length
    logger.info(
      `[partners] обновление фидов партнёров: готово за ${Math.round((Date.now() - started) / 1000)} с — ` +
        `обновлено ${ok} из ${results.length}`
    )
    return { ok, total: results.length, results }
  } catch (e: any) {
    logger.error(`[partners] обновление фидов партнёров: ошибка — ${e?.message}`)
    throw e
  }
}

export const config = {
  name: "partners-feed",
  schedule: process.env.PARTNERS_FEED_CRON || "0 * * * *",
}
