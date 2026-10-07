import { model } from "@medusajs/framework/utils"

/**
 * Партнёр с фид-ссылкой (авторазборка-поставщик).
 *
 * Склад партнёра = сам партнёр: в фидах колонки «склад/город» обычно нет,
 * поэтому название и город продавца ведём здесь — их видит покупатель
 * в корзине и в личном кабинете.
 *
 * Поля last_* — состояние последнего обновления фида: их показывает
 * страница «Партнёры» в админке и они же попадают в отчёт при сбое забора.
 */
export const Partner = model.define("partner", {
  id: model.id({ prefix: "ptr" }).primaryKey(),
  name: model.text(),
  city: model.text().default(""),
  feed_url: model.text(),
  /** кодировка фида: пусто — определить самому (utf-8 → windows-1251) */
  encoding: model.text().default(""),
  /** разделитель колонок: пусто — определить самому по заголовку */
  separator: model.text().default(""),
  /** дополнительные домены фотографий через запятую (если фото лежат не на домене партнёра) */
  photo_hosts: model.text().default(""),
  note: model.text().default(""),
  enabled: model.boolean().default(true),

  last_run_at: model.dateTime().nullable(),
  last_ok_at: model.dateTime().nullable(),
  /** never | ok | error */
  last_status: model.text().default("never"),
  last_error: model.text().nullable(),
  last_total: model.number().default(0),
  last_added: model.number().default(0),
  last_updated: model.number().default(0),
  /** снято с витрины: товар пропал из фида два прогона подряд */
  last_offline: model.number().default(0),
  last_without_price: model.number().default(0),
  last_duration_ms: model.number().default(0),
  active_count: model.number().default(0),
})

export default Partner
