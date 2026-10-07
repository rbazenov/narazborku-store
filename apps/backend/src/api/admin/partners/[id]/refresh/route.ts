import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { runPartnersFetch } from "../../../../../modules/partners/fetch"

/**
 * «Обновить сейчас» — забор фида партнёра по кнопке.
 *
 * Обычно фиды обновляются раз в час по расписанию; кнопка нужна, когда партнёр
 * поправил товар срочно или чтобы сразу проверить только что подключённую ссылку.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const id = String(req.params.id)

  try {
    const results = await runPartnersFetch(knex, {
      partnerId: id,
      log: (m: string) => logger.info(`[partners] ${m}`),
    })
    res.json({ results })
  } catch (e: any) {
    res.status(400).json({ message: e?.message || "Не удалось обновить фид" })
  }
}
