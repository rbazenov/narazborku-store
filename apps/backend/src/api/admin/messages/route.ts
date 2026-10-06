import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MESSAGES_MODULE } from "../../../modules/messages"
import MessagesModuleService from "../../../modules/messages/service"

/**
 * Раздел «Сообщения» в админке.
 *
 *   GET /admin/messages?q=…&filter=all|unread|important&limit=100
 *
 * Возвращает диалоги покупателей со всеми сообщениями, поиском по тексту
 * (сообщения, имя, почта, товар) и счётчиками для кнопок «Непрочитанные»
 * и «Важные».
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service: MessagesModuleService = req.scope.resolve(MESSAGES_MODULE)

  try {
    const result = await service.adminList({
      q: req.query.q as string,
      filter: req.query.filter as string,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    })
    res.json(result)
  } catch (e: any) {
    res.status(500).json({ message: e?.message || "Не удалось получить сообщения" })
  }
}
