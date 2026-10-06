import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MESSAGES_MODULE } from "../../../../modules/messages"
import MessagesModuleService, { ThreadAction } from "../../../../modules/messages/service"

/**
 * Один диалог покупателя.
 *
 *   GET  /store/messages/:id?client_id=…   — переписка
 *   POST /store/messages/:id               — действие: send | read | important |
 *                                            pin | block | hide | review | complaint
 */
const ACTIONS: ThreadAction[] = ["send", "read", "important", "pin", "block", "hide", "review", "complaint"]

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service: MessagesModuleService = req.scope.resolve(MESSAGES_MODULE)
  const customerId = (req as any).auth_context?.actor_id as string | undefined

  const conversation = await service.getForCustomer(req.params.id, {
    customer_id: customerId,
    client_id: String(req.query.client_id || ""),
  })

  if (!conversation) {
    res.status(404).json({ message: "Диалог не найден" })
    return
  }
  res.json({ conversation })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const service: MessagesModuleService = req.scope.resolve(MESSAGES_MODULE)
  const customerId = (req as any).auth_context?.actor_id as string | undefined
  const body = (req.body || {}) as Record<string, any>
  const action = String(body.action || "send") as ThreadAction

  if (!ACTIONS.includes(action)) {
    res.status(400).json({ message: "Неизвестное действие: " + action })
    return
  }
  if (action === "send" && !String(body.body || "").trim()) {
    res.status(400).json({ message: "Пустое сообщение" })
    return
  }

  try {
    const result = await service.actForCustomer(req.params.id, action, {
      customer_id: customerId,
      client_id: body.client_id,
      body: body.body,
      rating: body.rating,
    })
    if (!result) {
      res.status(404).json({ message: "Диалог не найден" })
      return
    }
    if ((result as any).blocked) {
      res.status(409).json({ message: "Чат заблокирован покупателем — сначала разблокируйте", conversation: (result as any).conversation })
      return
    }
    res.json(result)
  } catch (e: any) {
    res.status(400).json({ message: e?.message || "Действие не выполнено" })
  }
}
