import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MESSAGES_MODULE } from "../../../../modules/messages"
import MessagesModuleService, { AdminAction } from "../../../../modules/messages/service"

/**
 * Один диалог в админке.
 *
 *   GET  /admin/messages/:id   — переписка целиком
 *   POST /admin/messages/:id   — действие: reply | read | important
 */
const ACTIONS: AdminAction[] = ["reply", "read", "important"]

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service: MessagesModuleService = req.scope.resolve(MESSAGES_MODULE)
  const conversation = await service.adminGet(req.params.id)
  if (!conversation) {
    res.status(404).json({ message: "Диалог не найден" })
    return
  }
  res.json({ conversation })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const service: MessagesModuleService = req.scope.resolve(MESSAGES_MODULE)
  const body = (req.body || {}) as Record<string, any>
  const action = String(body.action || "reply") as AdminAction

  if (!ACTIONS.includes(action)) {
    res.status(400).json({ message: "Неизвестное действие: " + action })
    return
  }
  if (action === "reply" && !String(body.body || "").trim()) {
    res.status(400).json({ message: "Пустой ответ" })
    return
  }

  try {
    const result = await service.adminAct(req.params.id, action, { body: body.body })
    res.json(result)
  } catch (e: any) {
    res.status(400).json({ message: e?.message || "Действие не выполнено" })
  }
}
