import { createHash } from "crypto"
import { promises as fs } from "fs"
import path from "path"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Фотографии товаров партнёров — через наш магазин.
 *
 *   GET /partners/photo/<товар>/<номер>
 *
 * Путь намеренно НЕ начинается с /store: маршруты магазина требуют заголовок
 * с ключом публикации, а браузер его к <img> не добавляет — картинки бы
 * не открылись. Здесь ключ не нужен: ссылку знает только витрина, а сам
 * адрес непрозрачный (id товара и номер фотографии).
 *
 * Зачем прокси, а не прямая ссылка партнёра:
 *   • в браузер покупателя не попадают адреса чужих серверов (витрина показывает
 *     только наш домен — покупатель не видит, у кого магазин забрал товар);
 *   • фотографии партнёров часто отдаются по http, а страница витрины работает
 *     по https — браузер такие картинки блокирует; прокси решает это;
 *   • чужие серверы не нагружаются повторными запросами — картинка кэшируется.
 *
 * Проверка безопасности: скачиваем только то, что лежит на домене самого
 * партнёра (или его поддомене) либо на домене из его списка «домены фото».
 * Чужой адрес в параметре ничего не даст: ссылка берётся из базы по товару,
 * а не из запроса.
 */

const UA = "NarazborkuBot/1.0 (+https://finklass.online)"
const TIMEOUT_MS = 20_000
const MAX_BYTES = 8 * 1024 * 1024
const MEMORY_LIMIT = 400

type CacheEntry = { body: Buffer; type: string; at: number }
const memory = new Map<string, CacheEntry>()

/** домены фотографий, разрешённые для партнёра */
export function allowedPhotoHosts(feedUrl: string, photoHosts = ""): string[] {
  const list: string[] = []
  const extra = String(photoHosts || "")
    .split(/[,\s]+/)
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  list.push(...extra)

  try {
    const host = new URL(feedUrl).hostname.toLowerCase()
    // сам домен фида и его поддомены (например, export-content.baz-on.ru)
    list.push(host)
    const parts = host.split(".")
    if (parts.length > 2) list.push(parts.slice(-2).join("."))
  } catch {
    /* ссылка фида без домена — останутся только явные домены фото */
  }

  return Array.from(new Set(list))
}

async function loadProduct(knex: any, productId: string) {
  return await knex("partner_product as pp")
    .join("partner as p", "p.id", "pp.partner_id")
    .where("pp.id", productId)
    .whereNull("pp.deleted_at")
    .whereNull("p.deleted_at")
    .select("pp.id", "pp.photos", "p.feed_url", "p.photo_hosts")
    .first()
}

async function fetchPhoto(url: string): Promise<{ body: Buffer; type: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "image/*" }, signal: controller.signal })
    if (!res.ok) throw new Error("источник ответил " + res.status)
    const type = res.headers.get("content-type") || "image/jpeg"
    if (!/^image\//i.test(type)) throw new Error("источник отдал не картинку")
    const buf = Buffer.from(await res.arrayBuffer())
    if (!buf.length) throw new Error("пустая картинка")
    if (buf.length > MAX_BYTES) throw new Error("картинка слишком большая")
    return { body: buf, type: type.split(";")[0] }
  } finally {
    clearTimeout(timer)
  }
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const productId = String(req.params.id || "")
  const index = Number(req.params.index)

  try {
    if (!productId || !Number.isInteger(index) || index < 0) {
      return res.status(400).json({ message: "Неверная ссылка на фотографию" })
    }

    const product = await loadProduct(knex, productId)
    const photos: string[] = Array.isArray(product?.photos) ? product.photos : []
    const url = photos[index]
    if (!url || !/^https?:\/\//i.test(url)) return res.status(404).json({ message: "Фотография не найдена" })

    const hosts = allowedPhotoHosts(product.feed_url || "", product.photo_hosts || "")
    const host = new URL(url).hostname.toLowerCase()
    const ok = hosts.some((h) => host === h || host.endsWith("." + h))
    if (!ok) {
      return res.status(403).json({ message: "Домен фотографии не разрешён" })
    }

    const key = createHash("sha1").update(url).digest("hex")
    const etag = `"${key}"`

    if (req.headers["if-none-match"] === etag) return res.status(304).end()

    const cached = memory.get(key)
    if (cached) {
      res.setHeader("Content-Type", cached.type)
      res.setHeader("Cache-Control", "public, max-age=604800, immutable")
      res.setHeader("ETag", etag)
      return res.status(200).send(cached.body)
    }

    const { body, type } = await fetchPhoto(url)
    memory.set(key, { body, type, at: Date.now() })
    if (memory.size > MEMORY_LIMIT) {
      // вытесняем самые старые
      const oldest = [...memory.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, Math.floor(MEMORY_LIMIT / 4))
      for (const [k] of oldest) memory.delete(k)
    }

    res.setHeader("Content-Type", type)
    res.setHeader("Content-Length", String(body.length))
    res.setHeader("Cache-Control", "public, max-age=604800, immutable")
    res.setHeader("ETag", etag)
    res.status(200).send(body)
  } catch (e: any) {
    const msg = e?.name === "AbortError" ? "фотография не загрузилась вовремя" : e?.message || "не удалось получить фотографию"
    res.status(502).json({ message: msg })
  }
}
