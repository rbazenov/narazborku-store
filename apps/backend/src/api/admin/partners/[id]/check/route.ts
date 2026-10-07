import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PARTNERS_MODULE } from "../../../../../modules/partners"
import PartnersModuleService from "../../../../../modules/partners/service"
import { checkPartnerFeed } from "../../../../../modules/partners/fetch"

/**
 * «Проверить ссылку» — читаем фид, ничего не записывая в каталог.
 *
 * Показывает, что мы увидели: сколько товаров, какие колонки распознали, сколько
 * товаров с ценой и фото, и первые три строки. Так новую разборку можно
 * подключить, не засоряя витрину, если ссылка окажется нерабочей.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const service: PartnersModuleService = req.scope.resolve(PARTNERS_MODULE)
  const id = String(req.params.id)

  try {
    const partner: any = await service.retrievePartner(id)
    if (!partner?.feed_url) return res.status(400).json({ message: "У партнёра не заполнена ссылка на фид" })

    const result = await checkPartnerFeed({
      feed_url: partner.feed_url,
      encoding: partner.encoding || "",
      separator: partner.separator || "",
    })
    res.json(result)
  } catch (e: any) {
    res.status(400).json({ message: e?.message || "Не удалось проверить ссылку" })
  }
}
