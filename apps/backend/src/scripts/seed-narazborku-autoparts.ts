/**
 * Тестовый каталог «НаРазборку»: регион «Россия» (₽) + 10 товаров-автозапчастей,
 * повторяющих витрину лендинга. Запуск:
 *
 *   npx medusa exec ./src/scripts/seed-narazborku-autoparts.ts
 *
 * Скрипт идемпотентный: товары с существующим handle пропускаются,
 * повторный запуск ничего не ломает.
 */
import type { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules, ProductStatus } from '@medusajs/framework/utils'
import {
  createInventoryItemsWorkflow,
  createInventoryLevelsWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
} from '@medusajs/medusa/core-flows'

type Item = {
  title: string
  handle: string
  sku: string
  price: number
  qty: number
  category: string
  condition: string
  brand: string
  description: string
}

const CATEGORIES = [
  { name: 'Тормозная система', handle: 'brakes' },
  { name: 'Фильтры и масла', handle: 'filters-oils' },
  { name: 'Электрика и зажигание', handle: 'electric' },
  { name: 'Подвеска и рулевое', handle: 'suspension' },
  { name: 'Двигатель', handle: 'engine' },
]

// Каталог повторяет витрину лендинга (цены и артикулы оттуда же)
const ITEMS: Item[] = [
  { title: 'Фильтр масляный W 914/2', handle: 'mn-w9142', sku: 'MN-W9142', price: 390, qty: 300,
    category: 'filters-oils', condition: 'Новое', brand: 'Mann Filter',
    description: 'Фильтр масляный для двигателей 1.4–2.0 TSI. Аналог 06A115561B. Высота 96 мм, резьба 3/4-16 UNF.' },
  { title: 'Колодки тормозные передние дисковые', handle: 'bs-0986424896', sku: 'BS-0986424896', price: 2400, qty: 48,
    category: 'brakes', condition: 'Новое', brand: 'Bosch',
    description: 'Комплект передних колодок, 4 шт. Для Volkswagen Passat B6/B7, Audi A3/A4. Датчик износа в комплекте.' },
  { title: 'Масло Helix Ultra 5W-30, 4 л', handle: 'sh-550046344', sku: 'SH-550046344', price: 4300, qty: 40,
    category: 'filters-oils', condition: 'Новое', brand: 'Shell',
    description: 'Синтетическое моторное масло, API SP, ACEA C2/C3. Подходит для бензиновых и дизельных двигателей.' },
  { title: 'Свеча зажигания иридиевая BKR6EIX', handle: 'ngk6418', sku: 'NGK6418', price: 578, qty: 290,
    category: 'electric', condition: 'Новое', brand: 'NGK',
    description: 'Иридиевая свеча, зазор 0.8 мм, ресурс до 100 000 км. Резьба M14x1.25.' },
  { title: 'Фильтр масляный W 712/95', handle: 'mn-w71295', sku: 'MN-W71295', price: 410, qty: 150,
    category: 'filters-oils', condition: 'Новое', brand: 'Mann Filter',
    description: 'Фильтр масляный с обратным клапаном. Для Renault Logan, Duster, Lada Largus (K4M, K7M).' },
  { title: 'Лампа H7 12V 55W PX26d', handle: 'os-64210', sku: 'OS-64210', price: 350, qty: 120,
    category: 'electric', condition: 'Новое', brand: 'Osram',
    description: 'Галогенная лампа ближнего света, цоколь PX26d, 55 Вт, до 3200 К.' },
  { title: 'Жидкость тормозная DOT-4, 1 л', handle: 'bs-1987474102', sku: 'BS-1987474102', price: 640, qty: 90,
    category: 'brakes', condition: 'Новое', brand: 'Bosch',
    description: 'Синтетическая тормозная жидкость DOT-4, температура кипения 260 °C. Совместима с ABS.' },
  { title: 'Лампа H4 12V 60/55W P43t', handle: 'os-64193', sku: 'OS-64193', price: 320, qty: 140,
    category: 'electric', condition: 'Новое', brand: 'Osram',
    description: 'Галогенная лампа дальнего/ближнего света, цоколь P43t, 60/55 Вт.' },
  { title: 'Фильтр салонный угольный CUK 2939', handle: 'mn-cuk2939', sku: 'MN-CUK2939', price: 980, qty: 95,
    category: 'filters-oils', condition: 'Новое', brand: 'Mann Filter',
    description: 'Угольный фильтр салона с антибактериальным слоем. Для Skoda Octavia A5, VW Golf V/VI.' },
  { title: 'Свеча зажигания платиновая ZFR5F-11', handle: 'ngk7558', sku: 'NGK7558', price: 420, qty: 150,
    category: 'electric', condition: 'Новое', brand: 'NGK',
    description: 'Платиновая свеча, зазор 1.1 мм. Для Honda, Mazda, Mitsubishi, Kia, Hyundai.' },
]

export default async function seedNarazborkuAutoparts({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  // --- регион Россия (₽) -----------------------------------------------------
  const regionModule = container.resolve(Modules.REGION)
  let [region] = await regionModule.listRegions({ currency_code: 'rub' })
  if (!region) {
    const { result } = await createRegionsWorkflow(container).run({
      input: { regions: [{ name: 'Россия', currency_code: 'rub', countries: ['ru'] }] },
    })
    region = result[0]
    logger.info(`создан регион: ${region.name} (${region.currency_code})`)
  } else {
    logger.info(`регион уже есть: ${region.name} (${region.currency_code})`)
  }

  // --- категории -------------------------------------------------------------
  const categoryModule = container.resolve(Modules.PRODUCT)
  const existingCategories = await categoryModule.listProductCategories({}, { select: ['id', 'handle'] })
  const categoryIdByHandle: Record<string, string> = {}
  for (const c of existingCategories) categoryIdByHandle[c.handle!] = c.id

  const missing = CATEGORIES.filter((c) => !categoryIdByHandle[c.handle])
  if (missing.length) {
    const { result } = await createProductCategoriesWorkflow(container).run({
      input: { product_categories: missing.map((c) => ({ name: c.name, handle: c.handle, is_active: true })) },
    })
    for (const c of result) categoryIdByHandle[c.handle!] = c.id
    logger.info(`созданы категории: ${missing.map((c) => c.name).join(', ')}`)
  }

  // --- канал продаж и склад (созданы миграцией стартера) ----------------------
  const salesChannelModule = container.resolve(Modules.SALES_CHANNEL)
  const [defaultChannel] = await salesChannelModule.listSalesChannels({})
  const stockLocationModule = container.resolve(Modules.STOCK_LOCATION)
  let [location] = await stockLocationModule.listStockLocations({})
  if (!location) {
    const [created] = await stockLocationModule.createStockLocations([{ name: 'Склад Москва' }])
    location = created
    logger.info('создан склад: Склад Москва')
  }
  logger.info(`канал продаж: ${defaultChannel.name} | склад: ${location.name}`)

  // --- товары ---------------------------------------------------------------
  const productModule = container.resolve(Modules.PRODUCT)
  const existing = await productModule.listProducts({ handle: ITEMS.map((i) => i.handle) }, { select: ['handle'] })
  const existingHandles = new Set(existing.map((p) => p.handle))
  const toCreate = ITEMS.filter((i) => !existingHandles.has(i.handle))

  if (toCreate.length) {
    const { result } = await createProductsWorkflow(container).run({
      input: {
        products: toCreate.map((item) => ({
          title: item.title,
          handle: item.handle,
          description: item.description,
          status: ProductStatus.PUBLISHED,
          category_ids: [categoryIdByHandle[item.category]],
          sales_channels: [{ id: defaultChannel.id }],
          // характеристики выводятся в карточке товара в админке
          metadata: { артикул: item.sku, состояние: item.condition, бренд: item.brand },
          options: [{ title: 'Артикул', values: [item.sku] }],
          variants: [
            {
              title: item.sku,
              sku: item.sku,
              options: { Артикул: item.sku },
              prices: [{ amount: item.price, currency_code: 'rub' }],
            },
          ],
        })),
      },
    })
    logger.info(`создано товаров: ${result.length}`)
  } else {
    logger.info('товары уже есть — проверяю складские остатки')
  }

  // --- остатки по складу (выполняется ВСЕГДА, идемпотентно) -------------------
  // У варианта, созданного с SKU, позиция склада появляется автоматически; но уровни
  // остатков по складу надо проставлять отдельно — и следить, чтобы не появились дубли.
  const inventoryModule = container.resolve(Modules.INVENTORY)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const ourProducts = await productModule.listProducts(
    { handle: ITEMS.map((i) => i.handle) },
    { relations: ['variants'] }
  )
  const allVariantIds = ourProducts.flatMap((p) => p.variants!.map((v) => v.id))

  const { data: variantRows } = await query.graph({
    entity: 'variant',
    fields: ['id', 'inventory_items.inventory_item_id'],
    filters: { id: allVariantIds },
  })
  const existingItemByVariant = new Map<string, string>()
  for (const row of variantRows as any[]) {
    const item = row.inventory_items?.[0]
    if (item?.inventory_item_id) existingItemByVariant.set(row.id, item.inventory_item_id)
  }

  const variantIdsMissingItem = allVariantIds.filter((id) => !existingItemByVariant.has(id))

  let createdItems: any[] = []
  if (variantIdsMissingItem.length) {
    const { result } = await createInventoryItemsWorkflow(container).run({
      input: { items: variantIdsMissingItem.map((variantId) => ({ variant_id: variantId, requires_shipping: true })) },
    })
    createdItems = result
  }

  const qtyByVariant = new Map<string, number>()
  for (const p of ourProducts) {
    for (const v of p.variants!) {
      const src = ITEMS.find((i) => i.sku === v.sku!)
      if (src) qtyByVariant.set(v.id, src.qty)
    }
  }

  const allItemIds = [
    ...existingItemByVariant.values(),
    ...createdItems.map((item) => item.id),
  ]
  const itemToVariant = new Map<string, string>(existingItemByVariant)
  for (const item of createdItems) {
    const variantId = item.variants?.[0]?.variant_id
    if (variantId) itemToVariant.set(item.id, variantId)
  }

  const levels = await inventoryModule.listInventoryLevels({ inventory_item_id: allItemIds })
  const itemsWithLevel = new Set(levels.map((l) => l.inventory_item_id))

  const levelsToCreate = allItemIds
    .filter((id) => !itemsWithLevel.has(id))
    .map((id) => ({
      inventory_item_id: id,
      location_id: location.id,
      stocked_quantity: qtyByVariant.get(itemToVariant.get(id) ?? '') ?? 10,
    }))

  if (levelsToCreate.length) {
    await createInventoryLevelsWorkflow(container).run({ input: { inventory_levels: levelsToCreate } })
  }

  logger.info(`остатки по складу проставлены (новых уровней: ${levelsToCreate.length})`)
  logger.info(`готово: регион «${region.name}», товаров ${ourProducts.length}, категорий ${CATEGORIES.length}`)
}
