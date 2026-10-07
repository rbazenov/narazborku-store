import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { runPartnersFetch } from "../modules/partners/fetch"

/**
 * Ручной прогон сборщика фидов партнёров.
 *
 *   npm run partners:fetch              — все включённые партнёры
 *   npm run partners:fetch -- --id=ptr_…  — один партнёр
 *
 * Нужен для проверки на сервере и на случай, когда расписание недоступно.
 */
export default async function partnersFetchScript({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const argList = (args || []) as string[]
  const idArg = argList.find((a) => a.startsWith("--id="))
  const partnerId = idArg ? idArg.slice("--id=".length) : undefined

  const results = await runPartnersFetch(knex, { partnerId, log: (m) => logger.info(`[partners] ${m}`) })
  console.log(JSON.stringify(results, null, 2))
  return results
}
