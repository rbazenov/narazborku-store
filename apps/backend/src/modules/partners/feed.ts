import { createHash } from "crypto"

/**
 * Разбор фида партнёра-авторазборки.
 *
 * Фиды приходят «как есть» с сайтов партнёров: обычно это CSV с разделителем «;»
 * в кодировке windows-1251 (файл может называться site.xml — это не XML). Здесь
 * собраны чистые функции без обращений к базе и сети, чтобы разбор можно было
 * проверять отдельно на любом файле партнёра.
 *
 * Разбор терпимый к разнобою: колонки ищутся по названию (с учётом синонимов
 * и регистра), незнакомые колонки не теряются, а складываются в attrs — витрина
 * сможет показать их как характеристики.
 */

export type FeedProduct = {
  article: string
  title: string
  make: string
  model: string
  year: string
  body: string
  engine: string
  color: string
  part_number: string
  condition: string
  comment: string
  manufacturer: string
  price: number | null
  photos: string[]
  attrs: Record<string, string>
  status_text: string
  in_stock: boolean
  hash: string
}

export type ParsedFeed = {
  products: FeedProduct[]
  columns: string[]
  used: Record<string, string>
  /** колонки фида, которым не нашлось места (видно в «Проверить ссылку») */
  extra: string[]
  skipped: number
  separator: string
  encoding: string
}

/** Канонические поля и названия колонок, которыми их называют партнёры. */
const COLUMNS: Record<string, string[]> = {
  article: ["артикул", "артикул товара", "sku", "код", "код товара", "номер детали поставщика"],
  title: ["наименование", "название", "название товара", "товар", "name", "наименование товара", "запчасть"],
  make: ["марка", "марка авто", "марка автомобиля", "make"],
  model: ["модель", "модель авто", "model"],
  year: ["год", "год выпуска", "год авто"],
  body: ["кузов", "тип кузова"],
  engine: ["двигатель", "объём двигателя", "объем двигателя", "мотор"],
  color: ["цвет"],
  part_number: ["номер", "номер детали", "oem", "каталожный номер"],
  condition: ["новый/бу", "бу/новый", "состояние", "новое/бу", "тип"],
  comment: ["комментарий", "комментарии", "примечание", "описание"],
  manufacturer: ["производитель", "бренд", "бренд детали"],
  price: ["цена", "стоимость", "price", "цена руб"],
  photos: ["фото", "фото товара", "изображения", "картинки", "ссылка на фото", "фотографии", "image", "images"],
  status: ["статус", "наличие", "status"],
}

/** Колонки, которые уходят в attrs как характеристики (их наличие не гарантировано). */
const ATTR_COLUMNS = [
  "верх/низ",
  "перед/зад",
  "лев/прав",
  "лево/право",
  "сторона",
  "позиция",
  "комплектация",
]

const norm = (s: string) =>
  String(s == null ? "" : s)
    .replace(/\uFEFF/g, "")
    .replace(/ё/g, "е")
    .replace(/Ё/g, "Е")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()

/** Убираем html-мусор и лишние кавычки, которые иногда попадают в значения. */
const clean = (s: unknown, max = 500) =>
  String(s == null ? "" : s)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)

/**
 * Определяем кодировку файла: если байты — корректный UTF-8, значит UTF-8,
 * иначе windows-1251 (самый частый случай у российских партнёров).
 */
export function decodeFeed(buf: Uint8Array, encoding?: string): { text: string; encoding: string } {
  const forced = String(encoding || "").trim()
  if (forced) {
    return { text: new TextDecoder(forced as any).decode(buf), encoding: forced }
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(buf), encoding: "utf-8" }
  } catch {
    return { text: new TextDecoder("windows-1251").decode(buf), encoding: "windows-1251" }
  }
}

/** Определяем разделитель по заголовку: «;», табуляция или «,». */
export function detectSeparator(text: string): string {
  const head = text.split(/\r?\n/, 1)[0] || ""
  const counts: Array<[string, number]> = [
    [";", (head.match(/;/g) || []).length],
    ["\t", (head.match(/\t/g) || []).length],
    ["|", (head.match(/\|/g) || []).length],
    [",", (head.match(/,/g) || []).length],
  ]
  counts.sort((a, b) => b[1] - a[1])
  return counts[0][1] > 0 ? counts[0][0] : ";"
}

/**
 * Разбор таблицы с поддержкой кавычек (как в CSV): «"значение; с разделителем"».
 * Пустые строки выбрасываются.
 */
export function parseTable(text: string, separator: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        cell += ch
      }
      continue
    }

    if (ch === '"') {
      quoted = true
    } else if (ch === separator) {
      row.push(cell)
      cell = ""
    } else if (ch === "\n") {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ""
    } else if (ch === "\r") {
      // конец строки вида CRLF — закрываем строку, LF обработается следующим шагом
      if (text[i + 1] === "\n") {
        row.push(cell)
        rows.push(row)
        row = []
        cell = ""
        i++
      } else {
        cell += ch
      }
    } else {
      cell += ch
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  return rows.filter((r) => r.some((c) => String(c).trim().length > 0))
}

/**
 * Цена: «12 500,00 руб.» → 12500; «12.500» (точка как разделитель тысяч) → 12500.
 * Пусто или 0 → null — на витрине это «цена по запросу».
 */
export function parsePrice(raw: unknown): number | null {
  let s = String(raw == null ? "" : raw).replace(/[^\d.,]/g, "").trim()
  if (!s) return null

  // 12.500 / 1.234.567 — точка разделяет тысячи, а не копейки
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "")
  // 12,50 → 12.50
  if (!s.includes(".") && s.includes(",")) s = s.replace(",", ".")
  if (s.includes(".") && s.includes(",")) s = s.replace(/\./g, "").replace(",", ".")

  const value = Math.round(Number(s))
  if (!Number.isFinite(value) || value <= 0) return null
  return value
}

/** Фото: список ссылок через запятую/точку с запятой/пробел; мусор и дубли убираем. */
export function parsePhotos(raw: unknown): string[] {
  const parts = String(raw == null ? "" : raw).split(/[\s,;|]+/)
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of parts) {
    const url = p.trim()
    if (!/^https?:\/\/\S+$/i.test(url)) continue
    const key = url.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(url)
  }
  return out
}

/** В наличии или нет: скрываем только когда партнёр явно пишет, что товара нет. */
export function isInStock(statusText: string): boolean {
  const s = norm(statusText)
  if (!s) return true
  if (/нет в наличии|не в наличии|отсутствует|продан|снят с продаж|архив|нет на складе/.test(s)) return false
  return true
}

const hashOf = (p: Omit<FeedProduct, "hash">) =>
  createHash("sha1")
    .update(
      JSON.stringify([
        p.title, p.make, p.model, p.year, p.body, p.engine, p.color, p.part_number,
        p.condition, p.comment, p.manufacturer, p.price, p.photos, p.attrs, p.status_text, p.in_stock,
      ])
    )
    .digest("hex")

/** Сопоставляем заголовки фида с каноническими полями. */
function buildColumnMap(header: string[], separator: string) {
  const map: Record<string, number> = {}
  const used: Record<string, string> = {}
  const attrs: Array<{ key: string; index: number }> = []

  header.forEach((rawName, index) => {
    const name = norm(clean(rawName))
    if (!name) return
    let matched = false
    for (const [field, aliases] of Object.entries(COLUMNS)) {
      if (map[field] === undefined && aliases.includes(name)) {
        map[field] = index
        used[field] = clean(rawName)
        matched = true
        break
      }
    }
    if (!matched) {
      attrs.push({ key: clean(rawName, 60), index })
    }
  })

  return { map, used, attrs }
}

/**
 * Разбор фида целиком: заголовок + строки товаров.
 * Строки без артикула или названия пропускаем (это мусор и разделители).
 */
export function parseFeed(
  text: string,
  opts: { separator?: string; encoding?: string; attrColumns?: string[] } = {}
): ParsedFeed {
  const separator = String(opts.separator || "").trim() || detectSeparator(text)
  const table = parseTable(text, separator)
  if (!table.length) {
    return { products: [], columns: [], used: {}, extra: [], skipped: 0, separator, encoding: opts.encoding || "" }
  }

  const header = table[0]
  const { map, used, attrs } = buildColumnMap(header, separator)
  const attrNames = new Set([...(opts.attrColumns || []), ...ATTR_COLUMNS].map((s) => norm(s)))
  const extra = attrs.map((a) => a.key).filter((k) => !attrNames.has(norm(k)))

  const products: FeedProduct[] = []
  let skipped = 0

  for (const row of table.slice(1)) {
    const article = clean(row[map.article], 120)
    const title = clean(row[map.title])
    if (!article || !title) {
      skipped++
      continue
    }

    const attrMap: Record<string, string> = {}
    for (const { key, index } of attrs) {
      const value = clean(row[index], 120)
      if (value) attrMap[key] = value
    }
    const statusText = clean(row[map.status], 60)
    const base: Omit<FeedProduct, "hash"> = {
      article,
      title,
      make: clean(row[map.make], 80),
      model: clean(row[map.model], 80),
      year: clean(row[map.year], 20),
      body: clean(row[map.body], 60),
      engine: clean(row[map.engine], 60),
      color: clean(row[map.color], 40),
      part_number: clean(row[map.part_number], 80),
      condition: clean(row[map.condition], 40),
      comment: clean(row[map.comment], 400),
      manufacturer: clean(row[map.manufacturer], 80),
      price: parsePrice(row[map.price]),
      photos: parsePhotos(row[map.photos]),
      attrs: attrMap,
      status_text: statusText,
      in_stock: isInStock(statusText),
    }

    products.push({ ...base, hash: hashOf(base) })
  }

  return {
    products,
    columns: header.map((h) => clean(h, 80)).filter(Boolean),
    used,
    extra,
    skipped,
    separator,
    encoding: opts.encoding || "",
  }
}
