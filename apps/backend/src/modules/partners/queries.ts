/**
 * Выборки по товарам партнёров: счётчики для админки и список для витрины.
 *
 * Витрина читает только нашу копию каталога (таблицу partner_product) — к чужим
 * серверам в момент открытия страницы никто не обращается. Скрытыми считаются
 * товары, которых нет в фиде два прогона подряд, и товары выключенного партнёра.
 *
 * ВАЖНО: поля партнёра (partner_id, partner_name, partner_city) — только для
 * админки. Витринный маршрут (/store/partners/products) берёт из этих выборок
 * белый список полей товара и данные партнёра покупателю не отдаёт.
 */

export type PartnerCounts = {
  total: number
  active: number
  without_price: number
  photos: number
  updated_at: string | null
}

export type ProductQuery = {
  partner_id?: string
  q?: string
  /** категория витрины (Двигатель, Кузовные детали, …) */
  cat?: string
  price_min?: number
  price_max?: number
  limit?: number
  offset?: number
  sort?: "price_asc" | "price_desc" | "new" | "title"
  /** витрина берёт только активные товары; админка — все, чтобы видеть и скрытые */
  only_active?: boolean
  /** админке нужны и товары выключенного партнёра */
  include_disabled?: boolean
}

const clip = (v: unknown, max = 200) => String(v == null ? "" : v).slice(0, max).trim()

/** Сколько товаров у каждого партнёра (и сколько из них с ценой). */
export async function partnerCounts(knex: any, partnerId?: string): Promise<Record<string, PartnerCounts>> {
  const rows = await knex("partner_product")
    .whereNull("deleted_at")
    .modify((qb: any) => {
      if (partnerId) qb.where({ partner_id: partnerId })
    })
    .groupBy("partner_id")
    .select("partner_id")
    .count({ total: "*" })
    .select(knex.raw(`count(*) filter (where active) as active`))
    .select(knex.raw(`count(*) filter (where price is null) as without_price`))
    .select(knex.raw(`count(*) filter (where jsonb_array_length(coalesce(photos, '[]'::jsonb)) > 0) as photos`))
    .max({ updated_at: "updated_at" })

  const out: Record<string, PartnerCounts> = {}
  for (const r of rows) {
    out[String(r.partner_id)] = {
      total: Number(r.total) || 0,
      active: Number(r.active) || 0,
      without_price: Number(r.without_price) || 0,
      photos: Number(r.photos) || 0,
      updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : null,
    }
  }
  return out
}

/** Список товаров партнёров: для витрины (active) и для проверки в админке (все). */
export async function listPartnerProducts(knex: any, query: ProductQuery = {}) {
  const limit = Math.min(Math.max(Number(query.limit) || 24, 1), 100)
  const offset = Math.max(Number(query.offset) || 0, 0)
  const onlyActive = query.only_active !== false
  const search = clip(query.q, 120)

  const base = () =>
    knex("partner_product as pp")
      .join("partner as p", "p.id", "pp.partner_id")
      .whereNull("pp.deleted_at")
      .whereNull("p.deleted_at")
      .modify((qb: any) => {
        if (!query.include_disabled) qb.where({ "p.enabled": true })
        if (onlyActive) qb.where({ "pp.active": true })
        if (query.partner_id) qb.where({ "pp.partner_id": query.partner_id })
        if (query.cat) qb.where({ "pp.cat": clip(query.cat, 60) })
        if (Number.isFinite(query.price_min)) qb.where("pp.price", ">=", Number(query.price_min))
        if (Number.isFinite(query.price_max)) qb.where("pp.price", "<=", Number(query.price_max))
        if (Number.isFinite(query.price_min) || Number.isFinite(query.price_max)) qb.whereNotNull("pp.price")
        if (search) {
          /* Поиск по словам: каждое слово запроса должно найтись хотя бы в одном
             из полей товара. Введённое целиком название («Капот Оригинал
             (Volkswagen Transporter T5)») находит товар так же, как «капот»:
             слова ищутся по отдельности, регистр и знаки не важны. */
          const words = search
            .toLowerCase()
            .split(/[^\p{L}\p{N}]+/u)
            .filter((w) => w.length > 1)
            .slice(0, 6)
          for (const word of words.length ? words : [search]) {
            const like = `%${word}%`
            qb.andWhere((w: any) =>
              w
                .where("pp.title", "ilike", like)
                .orWhere("pp.make", "ilike", like)
                .orWhere("pp.model", "ilike", like)
                .orWhere("pp.part_number", "ilike", like)
                .orWhere("pp.article", "ilike", like)
                .orWhere("pp.manufacturer", "ilike", like)
                .orWhereRaw("pp.year::text ilike ?", [like])
            )
          }
        }
      })

  const rows = await base()
    .orderBy(
      query.sort === "price_asc"
        ? [{ column: "pp.price", order: "asc", nulls: "last" }]
        : query.sort === "price_desc"
        ? [{ column: "pp.price", order: "desc", nulls: "last" }]
        : query.sort === "title"
        ? [{ column: "pp.title", order: "asc" }]
        : [{ column: "pp.first_seen_at", order: "desc" }]
    )
    .limit(limit)
    .offset(offset)
    .select([
      "pp.id",
      "pp.partner_id",
      "pp.article",
      "pp.cat",
      "pp.title",
      "pp.make",
      "pp.model",
      "pp.year",
      "pp.body",
      "pp.engine",
      "pp.color",
      "pp.part_number",
      "pp.condition",
      "pp.comment",
      "pp.manufacturer",
      "pp.price",
      "pp.photos",
      "pp.attrs",
      "pp.status_text",
      "pp.in_stock",
      "pp.missing_runs",
      "pp.last_seen_at",
      "p.name as partner_name",
      "p.city as partner_city",
    ])

  const totalRow = await base().count({ n: "*" }).first()
  const total = Number(totalRow?.n) || 0

  return {
    products: rows.map((r: any) => ({
      ...r,
      photos: Array.isArray(r.photos) ? r.photos : [],
      attrs: r.attrs && typeof r.attrs === "object" ? r.attrs : {},
      price: r.price === null || r.price === undefined ? null : Number(r.price),
      seller: r.partner_name || "",
      seller_city: r.partner_city || "",
      last_seen_at: r.last_seen_at ? new Date(r.last_seen_at).toISOString() : null,
    })),
    count: total,
    offset,
    limit,
  }
}
