import { defineRouteConfig } from "@medusajs/admin-sdk"
import { BuildingStorefront, Trash } from "@medusajs/icons"
import { Button, Container, Heading, Input, Text } from "@medusajs/ui"
import { useCallback, useEffect, useMemo, useState } from "react"

/**
 * Раздел «Склад»: складские позиции магазина.
 *
 * Что умеет:
 *   — показывает сразу все позиции, без постраничного листания;
 *   — позволяет выбрать все позиции одним кликом (или отметить нужные);
 *   — удаляет выбранные позиции по кнопке, спрашивая подтверждение
 *     в поп-апе с кнопками «Удалить» и «Отменить».
 *
 * Важно: удаление складской позиции обнуляет остаток товара — товар
 * становится недоступен для онлайн-заказа и скрывается с витрины лендинга.
 */

type Level = { location_id?: string; stocked_quantity?: number }
type Item = { id: string; sku?: string | null; title?: string | null; location_levels?: Level[] }

const PAGE = 100

/** остаток по всем складам */
const stockOf = (it: Item) =>
  (it.location_levels || []).reduce((sum, l) => sum + (Number(l.stocked_quantity) || 0), 0)

const stockText = (it: Item) => {
  const n = stockOf(it)
  return n > 0 ? n + " шт." : "нет остатка"
}

const SkladPage = () => {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState("")
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [ask, setAsk] = useState<{ ids: string[]; labels: string[] } | null>(null)

  /** все позиции одним списком: страницы подгружаем сами, постраничного листания нет */
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const all: Item[] = []
      let offset = 0
      for (;;) {
        const res = await fetch(
          "/admin/inventory-items?limit=" + PAGE + "&offset=" + offset + "&fields=id,sku,title,*location_levels",
          { credentials: "include" }
        )
        if (!res.ok) throw new Error("магазин ответил " + res.status)
        const data = (await res.json()) as { inventory_items?: Item[] }
        const batch = data.inventory_items || []
        all.push(...batch)
        if (batch.length < PAGE) break
        offset += PAGE
        if (offset > 50000) break
      }
      setItems(all)
      setPicked({})
      setError("")
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить складские позиции")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const view = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return items
    return items.filter((i) => ((i.title || "") + " " + (i.sku || "")).toLowerCase().includes(s))
  }, [items, q])

  const pickedIds = useMemo(() => view.filter((i) => picked[i.id]).map((i) => i.id), [view, picked])
  const allOn = view.length > 0 && view.every((i) => picked[i.id])

  const toggleOne = (id: string) => setPicked((p) => ({ ...p, [id]: !p[id] }))

  const toggleAll = () =>
    setPicked((p) => {
      const next: Record<string, boolean> = { ...p }
      view.forEach((i) => {
        next[i.id] = !allOn
      })
      return next
    })

  const labelOf = (i: Item) => (i.title || "Без названия") + (i.sku ? " · " + i.sku : "")

  /** спрашиваем подтверждение перед удалением — поп-ап с «Удалить» и «Отменить» */
  const askDelete = (ids: string[]) => {
    const labels = ids.map((id) => {
      const it = items.find((x) => x.id === id)
      return it ? labelOf(it) : id
    })
    setAsk({ ids, labels })
  }

  const runDelete = async () => {
    if (!ask) return
    const ids = ask.ids
    setBusy(true)
    setNote("")
    let done = 0
    const failed: string[] = []
    for (const id of ids) {
      try {
        const res = await fetch("/admin/inventory-items/" + id, { method: "DELETE", credentials: "include" })
        if (!res.ok) throw new Error("код " + res.status)
        done++
      } catch (e) {
        failed.push(id)
      }
    }
    setBusy(false)
    setAsk(null)
    setNote(
      "Удалено позиций: " + done + (failed.length ? ", не удалось: " + failed.length : "")
    )
    await load()
  }

  return (
    <Container className="p-0">
      <div style={{ padding: "24px 24px 12px" }}>
        <Heading level="h1">Склад</Heading>
        <Text size="small" className="text-ui-fg-subtle" style={{ marginTop: 4 }}>
          Управляйте складскими позициями. Здесь видно все позиции сразу, можно выбрать все и удалить
          лишние. Удаление позиции обнуляет остаток: товар станет недоступен для онлайн-заказа и
          скроется с витрины лендинга.
        </Text>
      </div>

      {/* панель действий */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
          padding: "0 24px 16px",
        }}
      >
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={allOn} onChange={toggleAll} style={{ width: 16, height: 16 }} />
          <span style={{ fontSize: 13 }}>Выбрать все</span>
        </label>

        <Text size="small" className="text-ui-fg-subtle">
          Выбрано: {pickedIds.length} из {view.length}
          {items.length !== view.length ? " (всего " + items.length + ")" : ""}
        </Text>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ width: 260 }}>
            <Input
              size="small"
              placeholder="Поиск по названию или артикулу"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Button
            size="small"
            variant="danger"
            disabled={busy || pickedIds.length === 0}
            onClick={() => askDelete(pickedIds)}
          >
            Удалить выбранные{pickedIds.length ? " (" + pickedIds.length + ")" : ""}
          </Button>
        </div>
      </div>

      {note ? (
        <div style={{ padding: "0 24px 12px" }}>
          <Text size="small">{note}</Text>
        </div>
      ) : null}

      {error ? (
        <div style={{ padding: "0 24px 12px" }}>
          <Text size="small" className="text-ui-fg-error">
            {error}
          </Text>
        </div>
      ) : null}

      {/* список позиций: все на одной странице */}
      <div style={{ padding: "0 24px 24px" }}>
        {loading ? (
          <Text size="small" className="text-ui-fg-subtle">
            Загружаем складские позиции…
          </Text>
        ) : view.length === 0 ? (
          <div
            style={{
              border: "1px dashed var(--border-base, #E5E7EB)",
              borderRadius: 12,
              padding: "32px 20px",
              textAlign: "center",
            }}
          >
            <Text size="small" className="text-ui-fg-subtle">
              {items.length === 0
                ? "На складе пока нет позиций."
                : "По запросу ничего не найдено."}
            </Text>
          </div>
        ) : (
          <div style={{ border: "1px solid var(--border-base, #E5E7EB)", borderRadius: 12, overflow: "hidden" }}>
            {view.map((it, idx) => (
              <div
                key={it.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 16px",
                  borderTop: idx === 0 ? "none" : "1px solid var(--border-base, #E5E7EB)",
                  background: picked[it.id] ? "var(--bg-subtle, #F9FAFB)" : "transparent",
                }}
              >
                <input
                  type="checkbox"
                  checked={!!picked[it.id]}
                  onChange={() => toggleOne(it.id)}
                  style={{ width: 16, height: 16, flex: "none" }}
                  aria-label={"Выбрать: " + labelOf(it)}
                />
                <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                  <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {it.title || "Без названия"}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--fg-muted, #6B7280)" }}>
                    {it.sku ? "арт. " + it.sku : "без артикула"}
                  </div>
                </div>
                <Text size="small" className="text-ui-fg-subtle" style={{ flex: "none", minWidth: 96, textAlign: "right" }}>
                  {stockText(it)}
                </Text>
                <Button
                  size="small"
                  variant="transparent"
                  disabled={busy}
                  onClick={() => askDelete([it.id])}
                  aria-label={"Удалить: " + labelOf(it)}
                  title="Удалить позицию"
                >
                  <Trash />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* поп-ап подтверждения */}
      {ask ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(0,0,0,.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
          onClick={() => {
            if (!busy) setAsk(null)
          }}
          role="dialog"
          aria-modal="true"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(520px, 100%)",
              maxHeight: "80vh",
              overflow: "auto",
              background: "var(--bg-base, #FFFFFF)",
              color: "var(--fg-base, #111827)",
              borderRadius: 12,
              padding: 24,
              boxShadow: "0 20px 60px rgba(0,0,0,.3)",
            }}
          >
            <Heading level="h2">
              {ask.ids.length === 1
                ? "Удалить складскую позицию?"
                : "Удалить " + ask.ids.length + " складских позиций?"}
            </Heading>
            <Text size="small" className="text-ui-fg-subtle" style={{ display: "block", marginTop: 8 }}>
              Позиции будут удалены со склада, остаток обнулится: товары станут недоступны для
              онлайн-заказа и скроются с витрины. Действие нельзя отменить.
            </Text>
            <div
              style={{
                margin: "12px 0 16px",
                maxHeight: 200,
                overflow: "auto",
                border: "1px solid var(--border-base, #E5E7EB)",
                borderRadius: 8,
                padding: "10px 12px",
              }}
            >
              {ask.labels.slice(0, 50).map((l, i) => (
                <div key={i} style={{ fontSize: 13, padding: "2px 0" }}>
                  {l}
                </div>
              ))}
              {ask.labels.length > 50 ? (
                <div style={{ fontSize: 12, color: "var(--fg-muted, #6B7280)", paddingTop: 4 }}>
                  …и ещё {ask.labels.length - 50}
                </div>
              ) : null}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <Button size="small" variant="secondary" disabled={busy} onClick={() => setAsk(null)}>
                Отменить
              </Button>
              <Button size="small" variant="danger" disabled={busy} onClick={runDelete}>
                {busy ? "Удаляем…" : "Удалить"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Склад",
  icon: BuildingStorefront,
})

export default SkladPage
