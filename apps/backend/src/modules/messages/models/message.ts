import { model } from "@medusajs/framework/utils"

/**
 * Сообщение внутри диалога.
 *
 * sender: customer — покупатель, seller — продавец, system — служебная запись.
 * kind:   text — обычное сообщение, review — отзыв, complaint — жалоба.
 */
export const Message = model.define("message", {
  id: model.id({ prefix: "msg" }).primaryKey(),
  conversation_id: model.text(),
  sender: model.text().default("customer"),
  body: model.text(),
  kind: model.text().default("text"),
  rating: model.number().nullable(),
  read_by_seller: model.boolean().default(false),
  read_by_customer: model.boolean().default(true),
})

export default Message
