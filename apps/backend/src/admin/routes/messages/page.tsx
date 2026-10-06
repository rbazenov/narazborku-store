import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ChatBubbleLeftRight } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Text,
  Textarea,
} from "@medusajs/ui"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

/**
 * Раздел «Сообщения»: переписка покупателей с продавцом.
 *
 * Слева — список диалогов (поиск, кнопки «Непрочитанные» и «Важные»,
 * ранжирование: непрочитанные и важные — выше). Справа — переписка,
 * ответ продавца и пометки.
 */

type Msg = {
  id: string
  sender: "customer" | "seller" | "system"
  body: string
  kind: string
  rating: number | null
  read_by_seller: boolean
  t: string
}

type Conv = {
  id: string
  title: string
  subject: string
  product_id: string
  product_title: string
  product_icon: string
  customer_id: string
  customer_name: string
  customer_email: string
  channel: string
  order_ref: string
  preview: string
  unread_seller: number
  unread_customer: number
  important: boolean
  pinned: boolean
  blocked: boolean
  last_message_at: string | null
  messages: Msg[]
}

type Filters = { total: number; unread: number; important: number }

const timeLabel = (iso: string | null) => {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
  return sameDay ? time : d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" }) + " " + time
}

const kindLabel = (m: Msg) => {
  if (m.kind === "review") return "⭐ Отзыв" + (m.rating ? " · " + m.rating + "/5" : "")
  if (m.kind === "complaint") return "⚠ Жалоба на объявление"
  return ""
}

const MessagesPage = () => {
  const [convs, setConvs] = useState<Conv[]>([])
  const [stats, setStats] = useState<Filters>({ total: 0, unread: 0, important: 0 })
  const [filter, setFilter] = useState<"all" | "unread" | "important">("all")
  const [q, setQ] = useState("")
  const [activeId, setActiveId] = useState<string | null>(null)
  const [reply, setReply] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const timer = useRef<any>(null)
  const chatBox = useRef<HTMLDivElement | null>(null)

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      try {
        const res = await fetch(
          "/admin/messages?filter=" + filter + "&q=" + encodeURIComponent(q),
          { credentials: "include" }
        )
        if (!res.ok) throw new Error("магазин ответил " + res.status)
        const data = (await res.json()) as { conversations: Conv[]; stats: Filters }
        setConvs(data.conversations || [])
        setStats(data.stats || { total: 0, unread: 0, important: 0 })
        setError("")
      } catch (e: any) {
        if (!opts?.silent) setError(e?.message || "Не удалось загрузить сообщения")
      }
    },
    [filter, q]
  )

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => load(), 250)
    return () => timer.current && clearTimeout(timer.current)
  }, [load])

  // обновление раз в 20 секунд — новые сообщения покупателей появляются сами
  useEffect(() => {
    const id = setInterval(() => load({ silent: true }), 20000)
    return () => clearInterval(id)
  }, [load])

  const active = useMemo(() => convs.find((c) => c.id === activeId) || null, [convs, activeId])

  /* Последнее сообщение всегда на виду: при открытии диалога и после отправки ответа
     окно переписки само прокручивается вниз — искать новое сообщение вручную не нужно. */
  useLayoutEffect(() => {
    const box = chatBox.current
    if (!box) return
    box.scrollTop = box.scrollHeight
  }, [activeId, active?.messages.length])

  const open = async (conv: Conv) => {
    setActiveId(conv.id)
    setReply("")
    if (conv.unread_seller > 0) {
      await fetch("/admin/messages/" + conv.id, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "read" }),
      }).catch(() => null)
      load({ silent: true })
    }
  }

  const act = async (conv: Conv, action: string, body?: string) => {
    setBusy(true)
    try {
      const res = await fetch("/admin/messages/" + conv.id, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, body }),
      })
      if (!res.ok) {
        const t = await res.text()
        throw new Error(t.slice(0, 160))
      }
      await load({ silent: true })
    } catch (e: any) {
      setError(e?.message || "Действие не выполнено")
    } finally {
      setBusy(false)
    }
  }

  const send = async () => {
    if (!active || !reply.trim()) return
    const text = reply
    setReply("")
    await act(active, "reply", text)
  }

  const filterBtn = (key: "all" | "unread" | "important", label: string, count: number) => (
    <Button
      key={key}
      size="small"
      variant={filter === key ? "primary" : "secondary"}
      onClick={() => setFilter(key)}
    >
      {label} ({count})
    </Button>
  )

  return (
    <Container className="p-0">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid var(--border-base, #E5E7EB)" }}>
        <div>
          <Heading level="h1">Сообщения</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Переписка покупателей с продавцом. Всего диалогов: {stats.total}, непрочитанных: {stats.unread}, важных: {stats.important}
          </Text>
        </div>
        <Button size="small" variant="secondary" onClick={() => load()} disabled={busy}>
          Обновить
        </Button>
      </div>

      {error ? (
        <div style={{ padding: "10px 20px", color: "#B42318", fontSize: 13 }}>{error}</div>
      ) : null}

      <div style={{ display: "flex", minHeight: 520 }}>
        {/* слева: список диалогов */}
        <div style={{ width: 380, flex: "0 0 380px", borderRight: "1px solid var(--border-base, #E5E7EB)", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
            <Input
              size="small"
              placeholder="Поиск по сообщениям, имени, почте, товару"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {filterBtn("all", "Все", stats.total)}
              {filterBtn("unread", "Непрочитанные", stats.unread)}
              {filterBtn("important", "Важные", stats.important)}
            </div>
          </div>

          <div style={{ overflowY: "auto", flex: 1, maxHeight: 640 }}>
            {convs.length === 0 ? (
              <div style={{ padding: "18px 16px" }}>
                <Text size="small" className="text-ui-fg-subtle">
                  {q ? "Ничего не найдено — измените запрос." : "Сообщений пока нет. Покупатель может написать продавцу из карточки товара на лендинге."}
                </Text>
              </div>
            ) : (
              convs.map((c) => {
                const isActive = c.id === activeId
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => open(c)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "12px 14px",
                      border: 0,
                      borderBottom: "1px solid var(--border-base, #E5E7EB)",
                      background: isActive ? "var(--bg-subtle, #F5F5F5)" : "transparent",
                      cursor: "pointer",
                      display: "block",
                    }}
                  >
                    <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
                        <span style={{ fontSize: 18 }} aria-hidden>
                          {c.product_icon || "💬"}
                        </span>
                        <span style={{ fontWeight: 600, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 220 }}>
                          {c.title}
                        </span>
                      </div>
                      <Text size="xsmall" className="text-ui-fg-muted">
                        {timeLabel(c.last_message_at)}
                      </Text>
                    </div>
                    <div style={{ marginTop: 4, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {c.customer_name || c.customer_email || "Покупатель"}
                      </Text>
                      {c.unread_seller > 0 ? <Badge size="2xsmall" color="orange">не прочитано: {c.unread_seller}</Badge> : null}
                      {c.important ? <Badge size="2xsmall" color="blue">важное</Badge> : null}
                      {c.pinned ? <Badge size="2xsmall" color="grey">закреплено</Badge> : null}
                      {c.blocked ? <Badge size="2xsmall" color="red">чат заблокирован</Badge> : null}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 12, color: "var(--fg-subtle, #71717A)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {c.preview}
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* справа: переписка */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {!active ? (
            <div style={{ padding: 24 }}>
              <Text size="small" className="text-ui-fg-subtle">
                Выберите диалог слева, чтобы прочитать переписку и ответить покупателю.
              </Text>
            </div>
          ) : (
            <>
              <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border-base, #E5E7EB)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                  <div>
                    <Text weight="plus">
                      {active.product_icon || "💬"} {active.title}
                    </Text>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {active.customer_name || "Покупатель"}
                      {active.customer_email ? " · " + active.customer_email : ""}
                      {active.order_ref ? " · " + active.order_ref : ""}
                    </Text>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Button size="small" variant={active.important ? "primary" : "secondary"} onClick={() => act(active, "important")} disabled={busy}>
                      {active.important ? "Важное ✓" : "Отметить важным"}
                    </Button>
                    <Button size="small" variant="secondary" onClick={() => act(active, "read")} disabled={busy}>
                      Прочитано
                    </Button>
                  </div>
                </div>
              </div>

              <div ref={chatBox} style={{ flex: 1, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 10, maxHeight: 480 }}>
                {active.messages.map((m) => {
                  const mine = m.sender === "seller"
                  return (
                    <div key={m.id} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
                      <div
                        style={{
                          maxWidth: "78%",
                          background: mine ? "#E8F1FF" : "var(--bg-subtle, #F5F5F5)",
                          borderRadius: 10,
                          padding: "8px 12px",
                        }}
                      >
                        {kindLabel(m) ? (
                          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 3, color: m.kind === "complaint" ? "#B42318" : "#8A5B00" }}>
                            {kindLabel(m)}
                          </div>
                        ) : null}
                        <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{m.body}</div>
                        <div style={{ fontSize: 10, color: "#71717A", marginTop: 4 }}>
                          {mine ? "Продавец" : "Покупатель"} · {timeLabel(m.t)}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div style={{ padding: 14, borderTop: "1px solid var(--border-base, #E5E7EB)", display: "flex", flexDirection: "column", gap: 8 }}>
                <Textarea
                  placeholder="Ответ покупателю…"
                  value={reply}
                  rows={3}
                  onChange={(e) => setReply(e.target.value)}
                />
                {/* подпись слева одной строкой, кнопка — справа (на узком экране кнопка переносится, но остаётся справа) */}
                <div style={{ display: "flex", gap: 12, rowGap: 8, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                  <span
                    className="text-ui-fg-subtle"
                    style={{ flex: "1 1 auto", minWidth: 0, fontSize: 12, lineHeight: 1.2, whiteSpace: "nowrap" }}
                  >
                    Ответ появится в личном кабинете покупателя в разделе «Сообщения».
                  </span>
                  <Button size="small" style={{ flex: "none", marginLeft: "auto" }} onClick={send} disabled={busy || !reply.trim()}>
                    Отправить ответ
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Сообщения",
  icon: ChatBubbleLeftRight,
})

export default MessagesPage
