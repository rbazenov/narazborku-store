#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Правка формы «Создать складскую позицию» в админке:
#   — поле SKU получает русское название «Артикул (SKU)»;
#   — рядом со полем появляется значок «?» с подсказкой при наведении
#     (что писать: артикул = код товара, как на карточке на сайте);
#   — подсказка-пример в поле ввода: «например: FE-108005».
#
# Правка вносится в собранный файл админки (@medusajs/dashboard/dist/
# inventory-create-*.mjs) — исходная форма жёстко задана в коде Medusa,
# других точек расширения у неё нет. Скрипт идемпотентный: повторный запуск
# ничего не меняет. Изменённый файл сохраняется рядом как *.naz-orig (один раз).
#
# Запуск (по умолчанию — тестовый стенд):
#   bash patch-admin-sku-hint.sh                          # стенд
#   bash patch-admin-sku-hint.sh /srv/narazborku/app      # боевой
# После правки нужна пересборка админки (npm run build) и перезапуск службы.
# ---------------------------------------------------------------------------
set -euo pipefail

APP=${1:-/srv/narazborku/stage/app}
DIR="$APP/node_modules/@medusajs/dashboard/dist"
FILE=$(ls "$DIR"/inventory-create-*.mjs 2>/dev/null | head -1 || true)

if [ -z "${FILE:-}" ] || [ ! -f "$FILE" ]; then
  echo "  ! не найден файл формы создания складской позиции: $DIR/inventory-create-*.mjs"
  exit 1
fi
echo "  файл формы: $FILE"

[ -f "$FILE.naz-orig" ] || cp "$FILE" "$FILE.naz-orig"

python3 - "$FILE" <<'PY'
import io, sys

p = sys.argv[1]
s = io.open(p, encoding="utf-8").read()

CSS_OLD = "position:absolute;top:170%;left:-10px;z-index:80;width:300px;"
CSS_NEW = "position:absolute;top:150%;left:14px;z-index:80;width:300px;"

if "naz-sku-hint" in s:
    if CSS_OLD in s:                     # правка уже стоит — обновляем положение подсказки
        s = s.replace(CSS_OLD, CSS_NEW, 1)
        io.open(p, "w", encoding="utf-8").write(s)
        print("  обновлено: подсказка сдвинута вправо, чтобы не закрывать поле ввода")
        sys.exit(0)
    print("  уже применено — файл не изменён")
    sys.exit(0)

OLD_LABEL = '/* @__PURE__ */ jsx2(Form.Label, { children: t("fields.sku") }),'
OLD_INPUT = 'jsx2(Input, { ...field, placeholder: "sku-123" })'
if s.count(OLD_LABEL) != 1 or s.count(OLD_INPUT) != 1:
    print("  ! ожидаемые строки не найдены (подпись: %d, поле: %d) — правку надо проверить руками"
          % (s.count(OLD_LABEL), s.count(OLD_INPUT)))
    sys.exit(2)

HELPER = '''/* правка «НаРазборку»: значок «?» с подсказкой про артикул в форме создания складской позиции */
const nazSkuHintCss = ".naz-sku-hint{position:relative;display:inline-flex;align-items:center;justify-content:center;margin-left:6px;width:16px;height:16px;vertical-align:middle;cursor:help;outline:none}.naz-sku-hint-badge{width:16px;height:16px;border-radius:50%;background:#A1A1AA;color:#fff;font-size:11px;font-weight:700;line-height:1;display:inline-flex;align-items:center;justify-content:center}.naz-sku-hint-pop{position:absolute;top:150%;left:14px;z-index:80;width:300px;padding:10px 12px;border-radius:8px;background:#18181B;color:#fff;font-size:12px;font-weight:400;line-height:1.45;text-transform:none;letter-spacing:0;box-shadow:0 10px 30px rgba(0,0,0,.28);opacity:0;visibility:hidden;pointer-events:none;transition:opacity .12s ease}.naz-sku-hint:hover .naz-sku-hint-pop,.naz-sku-hint:focus .naz-sku-hint-pop{opacity:1;visibility:visible}";
const nazSkuHint = () => /* @__PURE__ */ jsxs("span", { className: "naz-sku-hint", tabIndex: 0, "aria-label": "Что писать в поле «Артикул»", children: [
  /* @__PURE__ */ jsx2("style", { children: nazSkuHintCss }),
  /* @__PURE__ */ jsx2("span", { className: "naz-sku-hint-badge", "aria-hidden": true, children: "?" }),
  /* @__PURE__ */ jsx2("span", { className: "naz-sku-hint-pop", role: "tooltip", children: "Артикул — это код товара на складе. Напишите его так же, как на карточке товара на сайте, например FE-108005 или MN-W9142. По этому коду сайт видит остаток и принимает заказы." })
] });
function InventoryCreate() {'''

NEW_LABEL = ('/* правка «НаРазборку»: русское название поля и значок-подсказка */\n'
             '                                      /* @__PURE__ */ jsxs(Form.Label, { children: ["Артикул (SKU)", nazSkuHint()] }),')
NEW_INPUT = 'jsx2(Input, { ...field, placeholder: "например: FE-108005" })'

s = s.replace("function InventoryCreate() {", HELPER, 1)
s = s.replace(OLD_LABEL, NEW_LABEL, 1)
s = s.replace(OLD_INPUT, NEW_INPUT, 1)

io.open(p, "w", encoding="utf-8").write(s)
print("  ok: поле «Артикул (SKU)» + значок «?» с подсказкой; пример в поле ввода обновлён")
PY

echo "  пересборка и перезапуск — задача вызывающего скрипта (update-stage-admin.sh делает это сам)."
