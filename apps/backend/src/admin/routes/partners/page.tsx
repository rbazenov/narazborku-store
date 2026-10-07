import { defineRouteConfig } from "@medusajs/admin-sdk"
import { HandTruck } from "@medusajs/icons"
import { Button, Container, Heading, Input, Text } from "@medusajs/ui"
import { useCallback, useEffect, useState } from "react"

/**
 * Раздел «Партнёры»: авторазборки, которые отдают товары по фид-ссылке.
 *
 * Что умеет:
 *   — подключать новую разборку: название, город, ссылка на фид;
 *   — показывать, когда фид обновлялся в последний раз и что внутри
 *     (сколько товаров, сколько показываем, сколько без цены, были ли ошибки);
 *   — «Проверить ссылку» — прочитать фид, ничего не записывая в каталог;
 *   — «Обновить сейчас» — забрать фид по кнопке, не дожидаясь часа;
 *   — включать/выключать партнёра и удалять его вместе с товарами.
 *
 * Обычно фиды обновляются раз в час сами — по расписанию магазина.
 */

type Counts = { total: number; active: number; without_price: number; photos: number; updated_at: string | null }

type Partner = {
  id: string
  name: string
  city: string
  feed_url: string
  enabled: boolean
  note: string
  last_status: "never" | "ok" | "error"
  last_run_at: string | null
  last_ok_at: string | null
  last_error: string | null
  last_total: number
  last_added: number
  last_updated: number
  last_offline: number
  last_without_price: number
  last_duration_ms: number
  active_count: number
  counts: Counts
}

type CheckResult = {
  ok: boolean
  error?: string
  bytes?: number
  encoding?: string
  separator?: string
  columns?: string[]
  mapped?: Record<string, string>
  extra_columns?: string[]
  rows?: number
  skipped?: number
  with_price?: number
  with_photos?: number
  photos_total?: number
  in_stock?: number
  sample?: Array<Record<string, any>>
  duration_ms: number
}

const money = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ")

const when = (iso?: string | null) => {
  if (!iso) return "ещё не обновлялся"
  const d = new Date(iso)
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

const ago = (iso?: string | null) => {
  if (!iso) return ""
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return "только что"
  if (min < 60) return `${min} мин назад`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} ч назад`
  return `${Math.round(h / 24)} дн назад`
}

const statusView = (p: Partner) => {
  if (p.last_status === "ok") return { text: "Обновлён", color: "#0e7a4f", bg: "#e8f6ee", border: "#bfe4cd" }
  if (p.last_status === "error") return { text: "Ошибка", color: "#b3261e", bg: "#fdecea", border: "#f3c3bd" }
  return { text: "Ещё не обновлялся", color: "#a15c00", bg: "#fff6e8", border: "#f0d9b0" }
}

const PartnersPage = () => {
  const [partners, setPartners] = useState<Partner[]>([])
  const [schedule, setSchedule] = useState<string>("раз в час")
  const [totals, setTotals] = useState<{ partners: number; enabled: number; products: number; active: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState("")

  const [form, setForm] = useState({ name: "", city: "", feed_url: "" })
  const [edit, setEdit] = useState<{ id: string; name: string; city: string; feed_url: string } | null>(null)
  const [ask, setAsk] = useState<string>("")
  const [check, setCheck] = useState<{ id: string; result: CheckResult } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/admin/partners", { credentials: "include" })
      if (!res.ok) throw new Error("магазин ответил " + res.status)
      const data = await res.json()
      setPartners(data.partners || [])
      setTotals(data.totals || null)
      setSchedule(data.schedule?.cron === "0 * * * *" ? "раз в час" : `по расписанию ${data.schedule?.cron || ""}`)
      setError("")
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить партнёров")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const add = async () => {
    if (!form.name.trim() || !form.feed_url.trim()) {
      setNote("Заполните название и ссылку на фид")
      return
    }
    setBusy("add")
    setNote("")
    try {
      const res = await fetch("/admin/partners", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || "магазин ответил " + res.status)
      setForm({ name: "", city: "", feed_url: "" })
      setNote(`Партнёр «${data.partner?.name || ""}» добавлен. Нажмите «Проверить ссылку», затем «Обновить сейчас».`)
      await load()
    } catch (e: any) {
      setNote("Не удалось добавить: " + (e?.message || ""))
    } finally {
      setBusy("")
    }
  }

  const save = async () => {
    if (!edit) return
    setBusy("save-" + edit.id)
    setNote("")
    try {
      const res = await fetch("/admin/partners/" + edit.id, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: edit.name, city: edit.city, feed_url: edit.feed_url }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || "магазин ответил " + res.status)
      setEdit(null)
      setNote("Изменения сохранены")
      await load()
    } catch (e: any) {
      setNote("Не удалось сохранить: " + (e?.message || ""))
    } finally {
      setBusy("")
    }
  }

  const toggle = async (p: Partner) => {
    setBusy("toggle-" + p.id)
    setNote("")
    try {
      const res = await fetch("/admin/partners/" + p.id, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !p.enabled }),
      })
      if (!res.ok) throw new Error("магазин ответил " + res.status)
      setNote(p.enabled ? `«${p.name}» выключен — товары скрыты с витрины, фид больше не забираем` : `«${p.name}» включён — фид снова обновляется`)
      await load()
    } catch (e: any) {
      setNote("Не удалось переключить: " + (e?.message || ""))
    } finally {
      setBusy("")
    }
  }

  const remove = async (p: Partner) => {
    setBusy("del-" + p.id)
    setNote("")
    try {
      const res = await fetch("/admin/partners/" + p.id, { method: "DELETE", credentials: "include" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || "магазин ответил " + res.status)
      setAsk("")
      setNote(`«${p.name}» удалён вместе с товарами (${data.removed_products || 0} шт.)`)
      await load()
    } catch (e: any) {
      setNote("Не удалось удалить: " + (e?.message || ""))
    } finally {
      setBusy("")
    }
  }

  const doCheck = async (p: Partner) => {
    setBusy("check-" + p.id)
    setNote("")
    setCheck(null)
    try {
      const res = await fetch("/admin/partners/" + p.id + "/check", { method: "POST", credentials: "include" })
      const data = (await res.json().catch(() => ({}))) as CheckResult
      if (!res.ok) throw new Error((data as any)?.message || "магазин ответил " + res.status)
      setCheck({ id: p.id, result: data })
      if (data.ok) setNote(`Ссылка рабочая: ${money(data.rows || 0)} товаров, ${money(data.with_price || 0)} с ценой`)
      else setNote("Ссылка не сработала: " + (data.error || ""))
    } catch (e: any) {
      setNote("Проверка не удалась: " + (e?.message || ""))
    } finally {
      setBusy("")
    }
  }

  const refresh = async (p: Partner) => {
    setBusy("refresh-" + p.id)
    setNote(`Забираем фид «${p.name}»…`)
    try {
      const res = await fetch("/admin/partners/" + p.id + "/refresh", { method: "POST", credentials: "include" })
      const data = await res.json().catch(() => ({}))
      const r = data?.results?.[0]
      if (!res.ok) throw new Error(data?.message || "магазин ответил " + res.status)
      if (r?.status === "ok") {
        setNote(
          `«${p.name}»: загружено ${money(r.total)} товаров — новых ${money(r.added)}, изменилось ${money(r.updated)}, ` +
            `скрыто ${money(r.offline)}, без цены ${money(r.without_price)}. Время: ${(r.duration_ms / 1000).toFixed(1)} с.`
        )
      } else {
        setNote(`«${p.name}»: не удалось — ${r?.error || "неизвестная ошибка"}. Прошлая копия осталась на витрине.`)
      }
      await load()
    } catch (e: any) {
      setNote("Обновление не удалось: " + (e?.message || ""))
    } finally {
      setBusy("")
    }
  }

  return (
    <Container className="p-0 divide-y">
      <div className="px-6 py-6">
        <Heading level="h1">Партнёры</Heading>
        <Text size="small" className="text-ui-fg-subtle mt-1">
          Авторазборки, которые отдают товары по фид-ссылке. Магазин забирает фиды {schedule} и показывает их товары
          на витрине <b>как обычные товары магазина</b>: покупатель не видит ни названия разборки, ни города, ни склада —
          ни в карточке товара, ни в заказе, ни в фильтрах. Всё это видно только здесь, в админке.
        </Text>

        {totals && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
            <span style={chipStyle}>Партнёров: <b>{money(totals.partners)}</b> (включено {money(totals.enabled)})</span>
            <span style={chipStyle}>Товаров в копии: <b>{money(totals.products)}</b></span>
            <span style={chipStyle}>Показываем на витрине: <b>{money(totals.active)}</b></span>
          </div>
        )}
      </div>

      <div className="px-6 py-6">
        <Heading level="h2">Подключить разборку</Heading>
        <Text size="small" className="text-ui-fg-subtle mt-1">
          Вставьте ссылку на фид, которую дал партнёр (у разных партнёров форматы могут отличаться — магазин определяет
          кодировку и разделитель сам).
        </Text>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <div style={{ flex: "1 1 200px", minWidth: 180 }}>
            <Text size="small" className="text-ui-fg-subtle mb-1">Название</Text>
            <Input placeholder="ИП Королёв" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div style={{ flex: "1 1 160px", minWidth: 140 }}>
            <Text size="small" className="text-ui-fg-subtle mb-1">Город</Text>
            <Input placeholder="Москва" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </div>
          <div style={{ flex: "3 1 360px", minWidth: 240 }}>
            <Text size="small" className="text-ui-fg-subtle mb-1">Ссылка на фид</Text>
            <Input
              placeholder="https://partner.ru/export/site.xml"
              value={form.feed_url}
              onChange={(e) => setForm({ ...form, feed_url: e.target.value })}
            />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <Button size="small" onClick={add} isLoading={busy === "add"} disabled={!!busy}>
              Добавить партнёра
            </Button>
          </div>
        </div>
      </div>

      {note && (
        <div className="px-6 py-4">
          <div style={{ background: "#eef5fd", border: "1px solid #cfe2f6", borderRadius: 10, padding: "10px 12px", fontSize: 13 }}>
            {note}
          </div>
        </div>
      )}

      {error && (
        <div className="px-6 py-4">
          <div style={{ background: "#fdecea", border: "1px solid #f3c3bd", borderRadius: 10, padding: "10px 12px", fontSize: 13 }}>
            {error}
          </div>
        </div>
      )}

      <div className="px-6 py-6">
        <Heading level="h2">Разборки ({partners.length})</Heading>

        {loading && <Text size="small" className="text-ui-fg-subtle mt-3">Загружаем…</Text>}
        {!loading && !partners.length && (
          <Text size="small" className="text-ui-fg-subtle mt-3">
            Пока никого не подключили. Добавьте первую разборку — например, ИП Королёв (baz-on.ru).
          </Text>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
          {partners.map((p) => {
            const st = statusView(p)
            const editing = edit?.id === p.id
            return (
              <div
                key={p.id}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 12,
                  padding: "14px 16px",
                  background: p.enabled ? "#fff" : "#fafbfc",
                  opacity: p.enabled ? 1 : 0.75,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 220 }}>
                    {editing ? (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                        <Input value={edit.city} onChange={(e) => setEdit({ ...edit, city: e.target.value })} />
                        <Input value={edit.feed_url} onChange={(e) => setEdit({ ...edit, feed_url: e.target.value })} />
                      </div>
                    ) : (
                      <>
                        <div style={{ fontWeight: 600, fontSize: 15 }}>
                          {p.name}
                          {p.city ? <span style={{ color: "#5d6b7d", fontWeight: 400 }}> · {p.city}</span> : null}
                        </div>
                        <a
                          href={p.feed_url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ fontSize: 12, color: "#0f6cbd", wordBreak: "break-all" }}
                        >
                          {p.feed_url}
                        </a>
                      </>
                    )}
                  </div>
                  <span
                    style={{
                      alignSelf: "flex-start",
                      background: st.bg,
                      border: `1px solid ${st.border}`,
                      color: st.color,
                      borderRadius: 20,
                      padding: "3px 12px",
                      fontSize: 12,
                      fontWeight: 600,
                      height: 24,
                    }}
                  >
                    {st.text}
                  </span>
                </div>

                <div style={{ marginTop: 10, fontSize: 13, color: "#33475e" }}>
                  {p.last_run_at ? (
                    <>
                      Обновлено {when(p.last_run_at)} ({ago(p.last_run_at)}) · в фиде {money(p.last_total)} товаров ·
                      показываем {money(p.counts.active)} · без цены {money(p.last_without_price)}
                      {p.last_added || p.last_updated ? (
                        <>
                          {" "}· при последнем обновлении: новых {money(p.last_added)}, изменилось {money(p.last_updated)}
                        </>
                      ) : null}
                      {p.last_offline ? <> · скрыто {money(p.last_offline)}</> : null}
                    </>
                  ) : (
                    <>Фид ещё не забирали — нажмите «Обновить сейчас» после проверки ссылки.</>
                  )}
                </div>

                {p.last_status === "error" && p.last_error && (
                  <div style={{ marginTop: 8, fontSize: 13, color: "#b3261e" }}>
                    Не удалось обновить: {p.last_error}. Витрина показывает прошлую копию каталога.
                  </div>
                )}

                {check?.id === p.id && (
                  <div style={{ marginTop: 10, background: "#f7fafd", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 12.5 }}>
                    {check.result.ok ? (
                      <>
                        <b>Ссылка рабочая.</b> Товаров: {money(check.result.rows || 0)} · с ценой:{" "}
                        {money(check.result.with_price || 0)} · с фото: {money(check.result.with_photos || 0)} (всего{" "}
                        {money(check.result.photos_total || 0)}) · в наличии: {money(check.result.in_stock || 0)} ·{" "}
                        {(check.result.bytes || 0) / 1024 < 1024
                          ? `${Math.round((check.result.bytes || 0) / 1024)} КБ`
                          : `${((check.result.bytes || 0) / 1048576).toFixed(1)} МБ`}{" "}
                        · кодировка {check.result.encoding} · разделитель «{check.result.separator}»
                        <div style={{ marginTop: 6, color: "#5d6b7d" }}>
                          Распознанные колонки: {Object.values(check.result.mapped || {}).join(", ")}
                          {check.result.extra_columns?.length
                            ? ` · незнакомые колонки: ${check.result.extra_columns.join(", ")}`
                            : ""}
                        </div>
                        {!!check.result.sample?.length && (
                          <div style={{ marginTop: 6, color: "#5d6b7d" }}>
                            Например:{" "}
                            {check.result.sample
                              .map((s) => `${s.title} (${s.make} ${s.model}${s.year ? ", " + s.year : ""})${s.price ? " — " + money(Number(s.price)) + " ₽" : " — цена по запросу"}`)
                              .join("; ")}
                          </div>
                        )}
                      </>
                    ) : (
                      <b style={{ color: "#b3261e" }}>Ссылка не сработала: {check.result.error}</b>
                    )}
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                  {editing ? (
                    <>
                      <Button size="small" onClick={save} isLoading={busy === "save-" + p.id} disabled={!!busy}>
                        Сохранить
                      </Button>
                      <Button size="small" variant="secondary" onClick={() => setEdit(null)} disabled={!!busy}>
                        Отмена
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="small" onClick={() => refresh(p)} isLoading={busy === "refresh-" + p.id} disabled={!!busy}>
                        Обновить сейчас
                      </Button>
                      <Button size="small" variant="secondary" onClick={() => doCheck(p)} isLoading={busy === "check-" + p.id} disabled={!!busy}>
                        Проверить ссылку
                      </Button>
                      <Button
                        size="small"
                        variant="secondary"
                        onClick={() => setEdit({ id: p.id, name: p.name, city: p.city, feed_url: p.feed_url })}
                        disabled={!!busy}
                      >
                        Изменить
                      </Button>
                      <Button size="small" variant="secondary" onClick={() => toggle(p)} isLoading={busy === "toggle-" + p.id} disabled={!!busy}>
                        {p.enabled ? "Выключить" : "Включить"}
                      </Button>
                      {ask === p.id ? (
                        <>
                          <Button size="small" variant="danger" onClick={() => remove(p)} isLoading={busy === "del-" + p.id} disabled={!!busy}>
                            Да, удалить вместе с товарами
                          </Button>
                          <Button size="small" variant="secondary" onClick={() => setAsk("")} disabled={!!busy}>
                            Отмена
                          </Button>
                        </>
                      ) : (
                        <Button size="small" variant="transparent" onClick={() => setAsk(p.id)} disabled={!!busy}>
                          Удалить
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="px-6 py-6">
        <Text size="small" className="text-ui-fg-subtle">
          Как это работает: магазин {schedule} сам скачивает фид каждой включённой разборки и складывает товары в свою
          копию каталога. На витрине это обычные товары — принадлежность партнёру и склад показываются только в админке.
          Если фид недоступен — на витрине остаётся прошлая копия каталога, а товар, пропавший из фида два обновления
          подряд, скрывается с витрины.
        </Text>
      </div>
    </Container>
  )
}

const chipStyle: React.CSSProperties = {
  background: "#f4f6f9",
  border: "1px solid #e2e8f0",
  borderRadius: 20,
  padding: "4px 12px",
  fontSize: 12.5,
}

export const config = defineRouteConfig({
  label: "Партнёры",
  icon: HandTruck,
})

export default PartnersPage
