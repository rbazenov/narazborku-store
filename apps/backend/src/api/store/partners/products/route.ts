import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { listPartnerProducts } from "../../../../modules/partners/queries"

/**
 * Товары из фидов партнёров — для витрины (лендинг).
 *
 *   GET /store/partners/products?q=&sort=price_asc|price_desc|new&limit=&offset=
 *
 * ВАЖНО: партнёр покупателю не виден. Витрина получает из этого ответа только
 * сам товар — название, характеристики, цену, фото. Ни названия разборки,
 * ни города, ни склада, ни признака «это товар партнёра» в ответе нет:
 * для покупателя это обычный товар магазина. Кому именно принадлежит товар,
 * знает только админка (там же — склад партнёра для отправки заказа).
 *
 * Поэтому здесь белый список полей: всё лишнее отбрасывается, чтобы данные
 * партнёра не попали на витрину даже случайно при будущих правках.
 */

const PUBLIC_FIELDS = [
  "id",
  "article",
  "title",
  "make",
  "model",
  "year",
  "body",
  "engine",
  "color",
  "part_number",
  "condition",
  "comment",
  "manufacturer",
  "price",
  "photos",
  "attrs",
  "status_text",
  "in_stock",
] as const

/** Оставляем только товар: без продавца, города и служебных полей партнёра. */
const toPublicProduct = (row: Record<string, any>) => {
  const out: Record<string, any> = {}
  for (const f of PUBLIC_FIELDS) out[f] = row[f] ?? null
  out.photos = Array.isArray(row.photos) ? row.photos : []
  out.attrs = row.attrs && typeof row.attrs === "object" ? row.attrs : {}
  return out
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  try {
    const result = await listPartnerProducts(knex, {
      q: (req.query.q as string) || undefined,
      sort: (req.query.sort as any) || undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
      only_active: true,
    })

    res.json({
      products: result.products.map(toPublicProduct),
      count: result.count,
      offset: result.offset,
      limit: result.limit,
    })
  } catch (e: any) {
    res.status(500).json({ message: e?.message || "Не удалось получить товары" })
  }
}
