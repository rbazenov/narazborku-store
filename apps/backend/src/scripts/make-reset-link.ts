import { ExecArgs } from "@medusajs/framework/types"
import { generateResetPasswordTokenWorkflow } from "@medusajs/core-flows"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Выдаёт готовую ссылку для сброса пароля администратора.
 *
 * Зачем: Medusa отправляет ссылку письмом, но почтовый провайдер (SMTP) пока не
 * подключён, поэтому письмо уходит «в никуда». Команда печатает ссылку прямо в
 * терминал — её достаточно открыть в браузере.
 *
 * Запуск на сервере:
 *   cd /srv/narazborku/app/apps/backend
 *   RESET_EMAIL=prodjectmen@gmail.com npm run reset-link
 *
 * Ссылка живёт 15 минут и позволяет один раз задать новый пароль.
 */
export default async function makeResetLink({ container }: ExecArgs) {
  const email = process.env.RESET_EMAIL
  if (!email) {
    throw new Error("Укажите адрес: RESET_EMAIL=pochta@example.com npm run reset-link")
  }

  const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE)
  const { http } = config.projectConfig

  const { result: token } = await generateResetPasswordTokenWorkflow(container).run({
    input: {
      entityId: email,
      actorType: "user",
      provider: "emailpass",
      secret: http.jwtSecret,
      jwtOptions: http.jwtOptions,
    },
  })

  const base = process.env.MEDUSA_BACKEND_URL || "http://77.233.221.183"
  const link = `${base}/app/reset-password?token=${token}&email=${encodeURIComponent(email)}`

  console.log("\n==============================================")
  console.log("Ссылка для сброса пароля (действует 15 минут):")
  console.log(link)
  console.log("==============================================\n")
}
