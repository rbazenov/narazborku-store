import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { addToCartWorkflow } from "@medusajs/core-flows"

/**
 * Позиция «под заказ» — товар, которого нет в каталоге магазина
 * (товары партнёров, подключённые по фид-ссылкам).
 *
 *   POST /store/carts/:cartId/custom-line-items
 *   { "title": "Капот Оригинал (Volkswagen Transporter T5)", "quantity": 1, "unit_price": 3500000 }
 *
 * В заказе такая позиция — только название, количество и цена. Ни товара каталога,
 * ни склада, ни продавца: покупателю о партнёре не известно ничего.
 *
 * Цена передаётся в копейках — в тех же единицах, в которых магазин считает
 * стоимость позиций каталога (3 100 ₽ = 310000).
 */
const CART_FIELDS = ["id", "currency_code", "region_id", "subtotal", "total", "*items"]

/** Корзина после добавления позиции — как отвечает штатный маршрут магазина. */
async function freshCart(id: string, scope: MedusaRequest["scope"]) {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "cart", fields: CART_FIELDS, filters: { id } })
  return data[0]
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body ?? {}) as { title?: unknown; quantity?: unknown; unit_price?: unknown }

  const title = String(body.title ?? "").trim().slice(0, 200)
  const quantity = Math.min(Math.max(Math.trunc(Number(body.quantity)) || 1, 1), 99)
  const unitPrice = Math.round(Number(body.unit_price))

  if (!title || !Number.isFinite(unitPrice) || unitPrice <= 0) {
    res.status(400).json({
      type: "invalid_data",
      message: "Укажите название, количество и цену позиции",
    })
    return
  }

  await addToCartWorkflow(req.scope).run({
    input: {
      cart_id: req.params.id,
      /* requires_shipping: false — у позиции нет товара каталога, а шаг проверки доставки
         магазина обращается к товару варианта. Доставка считается по заказу в целом. */
      items: [{ title, quantity, unit_price: unitPrice, requires_shipping: false }],
    },
  })

  res.json({ cart: await freshCart(req.params.id, req.scope) })
}
