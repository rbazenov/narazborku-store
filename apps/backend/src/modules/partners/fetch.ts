import { randomUUID } from "crypto"
import { decodeFeed, parseFeed, type FeedProduct } from "./feed"

/**
 * Забор данных партнёра по фид-ссылке.
 *
 * Порядок работы одного прогона:
 *   1) скачиваем файл по ссылке партнёра (с ограничением по времени);
 *   2) разбираем CSV (кодировку и разделитель определяем сами);
 *   3) обновляем нашу копию каталога: товар с той же парой «партнёр + артикул»
 *      перезаписывается, новый — добавляется;
 *   4) товары, которых нет в фиде, помечаем пропавшими; пропали два прогона
 *      подряд — прячем с витрины (случайная обрезка фида каталог не рушит);
 *   5) записываем в карточку партнёра итог: когда обновлялись, сколько товаров,
 *      были ли ошибки — это видно на странице «Партнёры» в админке.
 *
 * Если ссылка недоступна или партнёр отдал подозрительно мало строк — прогон
 * считается неудачным, прошлая копия каталога остаётся на витрине как есть.
 */

/** заголовок только латиницей: HTTP-заголовки не принимают кириллицу */
const UA = "NarazborkuBot/1.0 (+https://finklass.online)"
const CHUNK = 200
const DEFAULT_TIMEOUT_MS = 120_000
/** если партнёр отдал меньше 20 % прежнего числа товаров — считаем фид сломанным */
const SUSPICIOUS_RATIO = 0.2
const SUSPICIOUS_MIN = 20

export type PartnerRow = {
  id: string
  name: string
  city: string
  feed_url: string
  encoding: string
  separator: string
}

export type FetchResult = {
  partner_id: string
  name: string
  status: "ok" | "error"
  error?: string
  total?: number
  added?: number
  updated?: number
  unchanged?: number
  offline?: number
  without_price?: number
  in_stock?: number
  encoding?: string
  separator?: string
  duration_ms: number
  checked_at: string
}

export type CheckResult = {
  ok: boolean
  status: number | null
  error?: string
  bytes?: number
  encoding?: string
  separator?: string
  columns?: string[]
  mapped?: Record<string, string>
  extra_columns?: string[]
  rows?: number
  skipped?: number
  with_price?: number
  with_photos?: number
  photos_total?: number
  in_stock?: number
  sample?: Array<Record<string, unknown>>
  duration_ms: number
}

const pprodId = () => "pprod_" + randomUUID().replace(/-/g, "")

/** Колонки строки товара: 15 обычных + 2 jsonb (фото, характеристики) + 7 обычных. */
const ROW_PLACEHOLDERS = [...Array(15).fill("?"), "?::jsonb", "?::jsonb", ...Array(7).fill("?")]
const COLUMNS_IN_ROW = ROW_PLACEHOLDERS.length
const TUPLE = "(" + ROW_PLACEHOLDERS.join(",") + ")"

/** Скачивание фида с ограничением по времени. */
export async function downloadFeed(
  url: string,
  opts: { timeoutMs?: number; log?: (m: string) => void } = {}
): Promise<{ bytes: Uint8Array; status: number; content_type: string | null }> {
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/csv,text/plain,application/xml,text/xml,*/*" },
      signal: controller.signal,
      redirect: "follow",
    })
    if (!res.ok) {
      throw new Error(`партнёр ответил ${res.status} ${res.statusText || ""}`.trim())
    }
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (!bytes.length) throw new Error("пустой файл")
    return { bytes, status: res.status, content_type: res.headers.get("content-type") }
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error(`фид не ответил за ${Math.round(timeoutMs / 1000)} с`)
    throw new Error(e?.message || "не удалось скачать фид")
  } finally {
    clearTimeout(timer)
  }
}

/** Разбор скачанного фида (без записи в базу) — для кнопки «Проверить ссылку». */
export async function checkPartnerFeed(
  partner: Pick<PartnerRow, "feed_url" | "encoding" | "separator">,
  opts: { timeoutMs?: number } = {}
): Promise<CheckResult> {
  const started = Date.now()
  try {
    const { bytes, status } = await downloadFeed(partner.feed_url, opts)
    const dec = decodeFeed(bytes, partner.encoding)
    const feed = parseFeed(dec.text, { separator: partner.separator, encoding: dec.encoding })

    if (!feed.products.length) {
      return {
        ok: false,
        status,
        bytes: bytes.length,
        encoding: dec.encoding,
        separator: feed.separator,
        columns: feed.columns,
        error: "в файле не нашлось ни одного товара — проверьте, что ссылка ведёт на фид с товарами",
        duration_ms: Date.now() - started,
      }
    }

    const withPrice = feed.products.filter((p) => p.price !== null)
    return {
      ok: true,
      status,
      bytes: bytes.length,
      encoding: dec.encoding,
      separator: feed.separator,
      columns: feed.columns,
      mapped: feed.used,
      extra_columns: feed.extra,
      rows: feed.products.length,
      skipped: feed.skipped,
      with_price: withPrice.length,
      with_photos: feed.products.filter((p) => p.photos.length > 0).length,
      photos_total: feed.products.reduce((s, p) => s + p.photos.length, 0),
      in_stock: feed.products.filter((p) => p.in_stock).length,
      sample: feed.products.slice(0, 3).map((p) => ({
        article: p.article,
        title: p.title,
        make: p.make,
        model: p.model,
        year: p.year,
        price: p.price,
        condition: p.condition,
        photos: p.photos.length,
        status: p.status_text,
      })),
      duration_ms: Date.now() - started,
    }
  } catch (e: any) {
    return { ok: false, status: null, error: e?.message || "не удалось прочитать фид", duration_ms: Date.now() - started }
  }
}

/** Запись товаров пачками: одна пара «партнёр + артикул» — одна строка. */
async function upsertProducts(knex: any, partnerId: string, products: FeedProduct[], seenAt: Date) {
  for (let i = 0; i < products.length; i += CHUNK) {
    const chunk = products.slice(i, i + CHUNK)
    const values: any[] = []
    const tuples: string[] = []

    for (const p of chunk) {
      tuples.push(TUPLE)
      values.push(
        pprodId(), partnerId, p.article, p.title, p.make, p.model, p.year, p.body, p.engine,
        p.color, p.part_number, p.condition, p.comment, p.manufacturer, p.price,
        JSON.stringify(p.photos), JSON.stringify(p.attrs),
        p.status_text, p.in_stock, true, 0, p.hash, seenAt, seenAt
      )
    }

    // страховка: число значений должно совпадать с числом плейсхолдеров
    if (values.length !== chunk.length * COLUMNS_IN_ROW) {
      throw new Error(`внутренняя ошибка импорта: значений ${values.length}, ожидалось ${chunk.length * COLUMNS_IN_ROW}`)
    }

    await knex.raw(
      `insert into "partner_product"
        ("id","partner_id","article","title","make","model","year","body","engine","color","part_number",
         "condition","comment","manufacturer","price","photos","attrs","status_text","in_stock","active",
         "missing_runs","content_hash","first_seen_at","last_seen_at")
       values ${tuples.join(",")}
       on conflict ("partner_id","article") do update set
         "title" = excluded."title", "make" = excluded."make", "model" = excluded."model",
         "year" = excluded."year", "body" = excluded."body", "engine" = excluded."engine",
         "color" = excluded."color", "part_number" = excluded."part_number",
         "condition" = excluded."condition", "comment" = excluded."comment",
         "manufacturer" = excluded."manufacturer", "price" = excluded."price",
         "photos" = excluded."photos", "attrs" = excluded."attrs",
         "status_text" = excluded."status_text", "in_stock" = excluded."in_stock",
         "active" = true, "missing_runs" = 0, "content_hash" = excluded."content_hash",
         "last_seen_at" = excluded."last_seen_at", "updated_at" = now()`,
      values
    )
  }
}

/** Один прогон забора фида для партнёра. */
export async function fetchPartnerFeed(
  knex: any,
  partner: PartnerRow,
  opts: { timeoutMs?: number; log?: (m: string) => void } = {}
): Promise<FetchResult> {
  const started = Date.now()
  const log = opts.log || (() => {})
  const checkedAt = new Date()

  const fail = async (message: string): Promise<FetchResult> => {
    await knex("partner").where({ id: partner.id }).update({
      last_run_at: checkedAt,
      last_status: "error",
      last_error: message,
      last_duration_ms: Date.now() - started,
      updated_at: new Date(),
    })
    log(`✗ ${partner.name}: ${message}`)
    return {
      partner_id: partner.id,
      name: partner.name,
      status: "error",
      error: message,
      duration_ms: Date.now() - started,
      checked_at: checkedAt.toISOString(),
    }
  }

  try {
    log(`→ ${partner.name}: скачиваем ${partner.feed_url}`)
    const { bytes } = await downloadFeed(partner.feed_url, { timeoutMs: opts.timeoutMs })
    const dec = decodeFeed(bytes, partner.encoding)
    const feed = parseFeed(dec.text, { separator: partner.separator, encoding: dec.encoding })

    if (!feed.products.length) return await fail("в фиде нет ни одного товара")

    const before: Array<{ article: string; content_hash: string }> = await knex("partner_product")
      .where({ partner_id: partner.id })
      .andWhere((qb: any) => qb.whereNull("deleted_at"))
      .select("article", "content_hash")
    const known = new Map(before.map((r) => [String(r.article), String(r.content_hash || "")]))

    // защита от сломанного фида: резкое падение числа строк не должно обнулять витрину
    if (known.size > SUSPICIOUS_MIN && feed.products.length < known.size * SUSPICIOUS_RATIO) {
      return await fail(
        `партнёр отдал ${feed.products.length} строк вместо ${known.size} — похоже, фид сломан, оставили прошлую копию`
      )
    }

    const runAt = new Date()
    await upsertProducts(knex, partner.id, feed.products, runAt)

    // всё, чего не было в этом прогоне, считается пропавшим
    const missing = await knex("partner_product")
      .where({ partner_id: partner.id })
      .andWhere("last_seen_at", "<", runAt)
      .andWhere((qb: any) => qb.whereNull("deleted_at"))
      .increment("missing_runs", 1)

    const offlineRow = await knex("partner_product")
      .where({ partner_id: partner.id, active: true })
      .andWhere("missing_runs", ">=", 2)
      .andWhere((qb: any) => qb.whereNull("deleted_at"))
      .update({ active: false, updated_at: new Date() })
    const offline = Number(offlineRow) || 0

    let added = 0
    let updated = 0
    let unchanged = 0
    for (const p of feed.products) {
      const was = known.get(p.article)
      if (was === undefined) added++
      else if (was !== p.hash) updated++
      else unchanged++
    }

    const withoutPrice = feed.products.filter((p) => p.price === null).length
    const inStock = feed.products.filter((p) => p.in_stock).length
    const activeCount = added + updated + unchanged

    await knex("partner").where({ id: partner.id }).update({
      last_run_at: runAt,
      last_ok_at: runAt,
      last_status: "ok",
      last_error: null,
      last_total: feed.products.length,
      last_added: added,
      last_updated: updated,
      last_offline: offline,
      last_without_price: withoutPrice,
      last_duration_ms: Date.now() - started,
      active_count: activeCount,
      updated_at: runAt,
    })

    log(
      `✓ ${partner.name}: ${feed.products.length} товаров (новых ${added}, изменилось ${updated}), ` +
        `скрыто ${offline}, без цены ${withoutPrice}, ${dec.encoding}, ${feed.separator}`
    )

    return {
      partner_id: partner.id,
      name: partner.name,
      status: "ok",
      total: feed.products.length,
      added,
      updated,
      unchanged,
      offline,
      without_price: withoutPrice,
      in_stock: inStock,
      encoding: dec.encoding,
      separator: feed.separator,
      duration_ms: Date.now() - started,
      checked_at: runAt.toISOString(),
    }
  } catch (e: any) {
    return await fail(e?.message || "не удалось обновить фид")
  }
}

/** Прогон по всем включённым партнёрам (или по одному — админка, ручной запуск). */
export async function runPartnersFetch(
  knex: any,
  opts: { partnerId?: string; timeoutMs?: number; log?: (m: string) => void } = {}
): Promise<FetchResult[]> {
  const log = opts.log || (() => {})
  let rows: PartnerRow[] = await knex("partner")
    .whereNull("deleted_at")
    .modify((qb: any) => {
      if (opts.partnerId) qb.where({ id: opts.partnerId })
      else qb.where({ enabled: true })
    })
    .select("id", "name", "city", "feed_url", "encoding", "separator")

  if (opts.partnerId && !rows.length) throw new Error("партнёр не найден")
  log(`партнёров к обновлению: ${rows.length}`)

  const results: FetchResult[] = []
  for (const partner of rows) {
    if (!partner.feed_url) {
      results.push({
        partner_id: partner.id,
        name: partner.name,
        status: "error",
        error: "не заполнена ссылка на фид",
        duration_ms: 0,
        checked_at: new Date().toISOString(),
      })
      continue
    }
    results.push(await fetchPartnerFeed(knex, partner, { timeoutMs: opts.timeoutMs, log }))
  }

  const okCount = results.filter((r) => r.status === "ok").length
  log(`готово: обновлено ${okCount} из ${results.length}`)
  return results
}
