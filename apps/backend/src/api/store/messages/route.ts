import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MESSAGES_MODULE } from "../../../modules/messages"
import MessagesModuleService from "../../../modules/messages/service"

/**
 * Переписка покупателя с продавцом (сторона лендинга).
 *
 *   GET  /store/messages?client_id=…          — мои диалоги (кабинет, лендинг)
 *   POST /store/messages                      — начать диалог: первое сообщение
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service: MessagesModuleService = req.scope.resolve(MESSAGES_MODULE)
  const customerId = (req as any).auth_context?.actor_id as string | undefined
  const clientId = String(req.query.client_id || "")

  try {
    const conversations = await service.listForCustomer({ customer_id: customerId, client_id: clientId })
    res.json({ conversations })
  } catch (e: any) {
    res.status(500).json({ message: e?.message || "Не удалось получить сообщения" })
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const service: MessagesModuleService = req.scope.resolve(MESSAGES_MODULE)
  const customerId = (req as any).auth_context?.actor_id as string | undefined
  const body = (req.body || {}) as Record<string, any>

  if (!body.client_id && !customerId) {
    res.status(400).json({ message: "Не указан покупатель" })
    return
  }
  if (!String(body.body || "").trim() && String(body.kind || "text") === "text") {
    res.status(400).json({ message: "Пустое сообщение" })
    return
  }

  try {
    const result = await service.createThread({
      customer_id: customerId,
      client_id: body.client_id,
      customer_name: body.customer_name,
      customer_email: body.customer_email,
      product_id: body.product_id,
      product_title: body.product_title,
      product_icon: body.product_icon,
      subject: body.subject,
      channel: body.channel,
      order_ref: body.order_ref,
      body: body.body,
      kind: body.kind,
      rating: body.rating,
    })
    res.json(result)
  } catch (e: any) {
    res.status(400).json({ message: e?.message || "Сообщение не отправлено" })
  }
}
