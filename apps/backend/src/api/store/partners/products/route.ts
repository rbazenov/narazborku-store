import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { listPartnerProducts } from "../../../../modules/partners/queries"

/**
 * Товары партнёров для витрины (лендинг).
 *
 *   GET /store/partners/products?partner_id=&q=&sort=price_asc|price_desc|new&limit=&offset=
 *
 * Отдаём только активные товары включённых партнёров — то есть те, что есть
 * в свежем фиде. Наличие и цену витрина показывает как есть, без обращения
 * к сайтам партнёров.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  try {
    const result = await listPartnerProducts(knex, {
      partner_id: (req.query.partner_id as string) || undefined,
      q: (req.query.q as string) || undefined,
      sort: (req.query.sort as any) || undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
      only_active: true,
    })
    res.json(result)
  } catch (e: any) {
    res.status(500).json({ message: e?.message || "Не удалось получить товары партнёров" })
  }
}
