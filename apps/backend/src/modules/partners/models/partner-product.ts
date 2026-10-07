import { model } from "@medusajs/framework/utils"

/**
 * Товар партнёра, забранный из фида.
 *
 * Это наша копия каталога партнёра: витрина читает её, а не чужой файл.
 * Ключ товара — пара «партнёр + артикул» из фида, поэтому товары разных
 * разборок с одинаковыми артикулами не смешиваются.
 *
 * active — товар есть в фиде (или пропал недавно); missing_runs — сколько
 * прогонов подряд товара нет в фиде (после двух прогонов скрываем с витрины).
 */
export const PartnerProduct = model.define("partner_product", {
  id: model.id({ prefix: "pprod" }).primaryKey(),
  partner_id: model.text(),
  article: model.text(),
  title: model.text().default(""),
  make: model.text().default(""),
  model: model.text().default(""),
  year: model.text().default(""),
  body: model.text().default(""),
  engine: model.text().default(""),
  color: model.text().default(""),
  part_number: model.text().default(""),
  condition: model.text().default(""),
  comment: model.text().default(""),
  manufacturer: model.text().default(""),
  /** цена в рублях; null — «цена по запросу» */
  price: model.number().nullable(),
  photos: model.json().nullable(),
  attrs: model.json().nullable(),
  status_text: model.text().default(""),
  in_stock: model.boolean().default(true),
  active: model.boolean().default(true),
  missing_runs: model.number().default(0),
  content_hash: model.text().default(""),
  first_seen_at: model.dateTime().nullable(),
  last_seen_at: model.dateTime().nullable(),
})

export default PartnerProduct
