import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { listPartnerProducts, partnerCounts } from "../../../../../modules/partners/queries"

/**
 * Товары одного партнёра — для админки (здесь партнёр виден, покупателю — нет).
 *
 *   GET /admin/partners/:id/products?q=&sort=&limit=&offset=
 *
 * Показываем и скрытые товары (нет в фиде два прогона подряд), чтобы было видно,
 * что происходит с каталогом партнёра: всего / показываем на витрине.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const id = String(req.params.id)

  try {
    const counts = await partnerCounts(knex, id)
    const rows = await listPartnerProducts(knex, {
      partner_id: id,
      q: (req.query.q as string) || undefined,
      sort: (req.query.sort as any) || undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
      only_active: false,
      include_disabled: true,
    })

    res.json({
      products: rows.products,
      count: rows.count,
      active_count: counts[id]?.active || 0,
      total_count: counts[id]?.total || 0,
    })
  } catch (e: any) {
    res.status(500).json({ message: e?.message || "Не удалось получить товары партнёра" })
  }
}
