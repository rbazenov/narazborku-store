import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PARTNERS_MODULE } from "../../../../modules/partners"
import PartnersModuleService from "../../../../modules/partners/service"

/**
 * Один партнёр.
 *
 *   PATCH  /admin/partners/:id  — правка: название, город, ссылка, вкл/выкл
 *   DELETE /admin/partners/:id  — отключить партнёра вместе с его товарами
 */
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const service: PartnersModuleService = req.scope.resolve(PARTNERS_MODULE)
  const body = (req.body || {}) as Record<string, any>
  const id = String(req.params.id)

  const patch: Record<string, any> = {}
  if (body.name !== undefined) {
    const name = String(body.name).trim()
    if (!name) return res.status(400).json({ message: "Название не может быть пустым" })
    patch.name = name.slice(0, 120)
  }
  if (body.city !== undefined) patch.city = String(body.city).trim().slice(0, 80)
  if (body.feed_url !== undefined) {
    const url = String(body.feed_url).trim()
    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({ message: "Ссылка на фид должна начинаться с http:// или https://" })
    }
    patch.feed_url = url.slice(0, 500)
  }
  if (body.encoding !== undefined) patch.encoding = String(body.encoding).trim().slice(0, 40)
  if (body.separator !== undefined) patch.separator = String(body.separator).trim().slice(0, 4)
  if (body.note !== undefined) patch.note = String(body.note).trim().slice(0, 300)
  if (body.enabled !== undefined) patch.enabled = !!body.enabled

  if (!Object.keys(patch).length) return res.status(400).json({ message: "Нечего менять" })

  try {
    const partner = await service.updatePartners({ id, ...patch })
    res.json({ partner })
  } catch (e: any) {
    res.status(500).json({ message: e?.message || "Не удалось сохранить изменения" })
  }
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const service: PartnersModuleService = req.scope.resolve(PARTNERS_MODULE)
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const id = String(req.params.id)

  try {
    // товары партнёра удаляем совсем: иначе они останутся висеть без хозяина
    const removed = await knex("partner_product").where({ partner_id: id }).del()
    await service.deletePartners(id)
    res.json({ id, removed_products: Number(removed) || 0 })
  } catch (e: any) {
    res.status(500).json({ message: e?.message || "Не удалось удалить партнёра" })
  }
}
