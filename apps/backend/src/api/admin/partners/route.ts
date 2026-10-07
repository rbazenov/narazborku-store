import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PARTNERS_MODULE } from "../../../modules/partners"
import PartnersModuleService from "../../../modules/partners/service"
import { partnerCounts } from "../../../modules/partners/queries"

/**
 * Раздел «Партнёры» в админке.
 *
 *   GET  /admin/partners   — список партнёров + сколько товаров у каждого
 *   POST /admin/partners   — подключить новую разборку (ссылка на фид)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service: PartnersModuleService = req.scope.resolve(PARTNERS_MODULE)
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  try {
    const partners = await service.listPartners({}, { order: { created_at: "ASC" } })
    const counts = await partnerCounts(knex)

    const list = partners.map((p: any) => {
      const c = counts[p.id] || { total: 0, active: 0, without_price: 0, photos: 0, updated_at: null }
      return {
        ...p,
        counts: c,
      }
    })

    res.json({
      partners: list,
      schedule: {
        cron: process.env.PARTNERS_FEED_CRON || "0 * * * *",
        hint: "раз в час",
      },
      totals: {
        partners: list.length,
        enabled: list.filter((p: any) => p.enabled).length,
        products: list.reduce((s: number, p: any) => s + p.counts.total, 0),
        active: list.reduce((s: number, p: any) => s + p.counts.active, 0),
      },
    })
  } catch (e: any) {
    res.status(500).json({ message: e?.message || "Не удалось получить список партнёров" })
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const service: PartnersModuleService = req.scope.resolve(PARTNERS_MODULE)
  const body = (req.body || {}) as Record<string, any>

  const name = String(body.name || "").trim()
  const feedUrl = String(body.feed_url || "").trim()

  if (!name) return res.status(400).json({ message: "Укажите название партнёра" })
  if (!/^https?:\/\//i.test(feedUrl)) {
    return res.status(400).json({ message: "Ссылка на фид должна начинаться с http:// или https://" })
  }

  try {
    const partner = await service.createPartners({
      name: name.slice(0, 120),
      city: String(body.city || "").trim().slice(0, 80),
      feed_url: feedUrl.slice(0, 500),
      encoding: String(body.encoding || "").trim().slice(0, 40),
      separator: String(body.separator || "").trim().slice(0, 4),
      note: String(body.note || "").trim().slice(0, 300),
      enabled: body.enabled === false ? false : true,
      last_status: "never",
    })
    res.status(201).json({ partner })
  } catch (e: any) {
    res.status(500).json({ message: e?.message || "Не удалось добавить партнёра" })
  }
}
