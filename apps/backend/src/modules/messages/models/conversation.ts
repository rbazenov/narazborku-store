import { model } from "@medusajs/framework/utils"

/**
 * Диалог покупателя с продавцом.
 *
 * Один диалог — это переписка по одному товару (или по заказу, или просто
 * вопрос). Покупатель может писать из карточки товара, из кабинета или из
 * заказа; продавец отвечает из админки (раздел «Сообщения»).
 */
export const Conversation = model.define("conversation", {
  id: model.id({ prefix: "conv" }).primaryKey(),

  // кто покупатель: аккаунт магазина и/или анонимный «ключ браузера»
  customer_id: model.text().nullable(),
  client_id: model.text().nullable(),
  customer_name: model.text().nullable(),
  customer_email: model.text().nullable(),

  // о чём диалог
  product_id: model.text().nullable(),
  product_title: model.text().nullable(),
  product_icon: model.text().nullable(),
  subject: model.text().nullable(),
  channel: model.text().default("product"), // product | order | question
  order_ref: model.text().nullable(),

  // последнее сообщение — для списков
  preview: model.text().nullable(),
  last_message_at: model.dateTime().nullable(),

  // непрочитанные: отдельно для продавца и для покупателя
  unread_seller: model.number().default(0),
  unread_customer: model.number().default(0),

  // пометки покупателя: важное, закреплённое, заблокированное, скрытое
  important: model.boolean().default(false),
  pinned: model.boolean().default(false),
  blocked: model.boolean().default(false),
  hidden: model.boolean().default(false),
})

export default Conversation
