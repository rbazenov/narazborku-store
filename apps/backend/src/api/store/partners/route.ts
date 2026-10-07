import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PARTNERS_MODULE } from "../../../modules/partners"
import PartnersModuleService from "../../../modules/partners/service"
import { partnerCounts } from "../../../modules/partners/queries"

/**
 * Партнёры для витрины (лендинг).
 *
 *   GET /store/partners — включённые разборки и сколько у каждой товаров
 *
 * Нужен лендингу для фильтра «продавец» и подписи склада в корзине.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service: PartnersModuleService = req.scope.resolve(PARTNERS_MODULE)
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  try {
    const partners = await service.listPartners({ enabled: true }, { order: { created_at: "ASC" } })
    const counts = await partnerCounts(knex)

    res.json({
      partners: partners.map((p: any) => ({
        id: p.id,
        name: p.name,
        city: p.city,
        products: counts[p.id]?.active || 0,
        updated_at: counts[p.id]?.updated_at || p.last_ok_at || null,
      })),
    })
  } catch (e: any) {
    res.status(500).json({ message: e?.message || "Не удалось получить партнёров" })
  }
}
