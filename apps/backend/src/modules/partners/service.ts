import { MedusaService } from "@medusajs/framework/utils"
import Partner from "./models/partner"
import PartnerProduct from "./models/partner-product"

/**
 * Служба партнёров: справочник разборок с фид-ссылками и их товары.
 *
 * Справочник (кто, город, ссылка, включён ли) — обычные записи модуля.
 * Товары партнёров забирает сборщик (см. ./fetch.ts): он вызывается
 * по расписанию, из админки («Обновить сейчас») и из скрипта на сервере.
 */
class PartnersModuleService extends MedusaService({
  Partner,
  PartnerProduct,
}) {
  /** Партнёры для сборщика: включённые, по порядку добавления. */
  async listEnabledPartners() {
    return await this.listPartners({ enabled: true }, { order: { created_at: "ASC" } })
  }
}

export default PartnersModuleService
