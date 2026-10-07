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
  "cat",
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

/** Сколько фотографий отдаём витрине (карточка + галерея товара). */
const PHOTOS_LIMIT = 12

/**
 * Оставляем только товар: без продавца, города и служебных полей партнёра.
 *
 * Фотографии отдаём не ссылками партнёра, а через наш магазин
 * (/partners/photo/<товар>/<номер>): в браузер покупателя адреса чужих
 * серверов не попадают, а картинки работают по https без ограничений браузера.
 */
const toPublicProduct = (row: Record<string, any>) => {
  const out: Record<string, any> = {}
  for (const f of PUBLIC_FIELDS) out[f] = row[f] ?? null
  const photos = Array.isArray(row.photos) ? row.photos : []
  out.photos = photos.slice(0, PHOTOS_LIMIT).map((_: string, i: number) => `/partners/photo/${row.id}/${i}`)
  out.photos_count = photos.length
  out.attrs = row.attrs && typeof row.attrs === "object" ? row.attrs : {}
  return out
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  try {
    const num = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : Number(v))
    const result = await listPartnerProducts(knex, {
      q: (req.query.q as string) || undefined,
      cat: (req.query.cat as string) || undefined,
      price_min: num(req.query.price_min),
      price_max: num(req.query.price_max),
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
