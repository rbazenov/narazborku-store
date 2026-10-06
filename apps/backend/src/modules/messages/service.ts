import { MedusaService } from "@medusajs/framework/utils"
import Conversation from "./models/conversation"
import Message from "./models/message"

export type ThreadAction =
  | "send"
  | "read"
  | "important"
  | "pin"
  | "block"
  | "hide"
  | "review"
  | "complaint"

export type AdminAction = "reply" | "read" | "important"

const clip = (v: unknown, max = 400) => String(v == null ? "" : v).slice(0, max)

/**
 * Служба сообщений: диалоги покупателей с продавцом.
 *
 * Покупатель пишет из карточки товара, из кабинета или из заказа; продавец
 * отвечает из админки. Состояние диалога (непрочитанные, важное, закреплённое,
 * заблокированное, скрытое) хранится здесь же, чтобы кабинет и админка видели
 * одну и ту же картину.
 */
class MessagesModuleService extends MedusaService({
  Conversation,
  Message,
}) {
  /** Диалоги покупателя: и по аккаунту, и по «ключу браузера» (сообщения до входа). */
  async listForCustomer(input: { customer_id?: string; client_id?: string }) {
    const customerId = clip(input.customer_id, 100) || null
    const clientId = clip(input.client_id, 100) || null

    if (customerId && clientId) {
      // покупатель вошёл в кабинет — подбираем сообщения, отправленные до входа
      const guests = await this.listConversations({ client_id: clientId, customer_id: null })
      for (const c of guests) {
        await this.updateConversations({ id: c.id, customer_id: customerId })
      }
    }

    const filters = customerId ? { customer_id: customerId } : clientId ? { client_id: clientId } : null
    if (!filters) return []

    const conversations = await this.listConversations(filters, {
      order: { last_message_at: "DESC" } as any,
    })
    if (!conversations.length) return []

    const ids = conversations.map((c) => c.id)
    const messages = await this.listMessages({ conversation_id: ids }, { order: { created_at: "ASC" } })

    return conversations
      .filter((c) => !c.hidden)
      .map((c) => this.shape(c, messages.filter((m) => m.conversation_id === c.id)))
  }

  /** Один диалог покупателя (для экрана переписки). */
  async getForCustomer(id: string, input: { customer_id?: string; client_id?: string }) {
    const conversation = await this.retrieveConversation(id)
    const mine =
      (input.customer_id && conversation.customer_id === input.customer_id) ||
      (input.client_id && conversation.client_id === input.client_id)
    if (!mine) return null

    const messages = await this.listMessages({ conversation_id: id }, { order: { created_at: "ASC" } })
    return this.shape(conversation, messages)
  }

  /** Новый диалог: первое сообщение покупателя (из карточки товара или из кабинета). */
  async createThread(input: {
    customer_id?: string
    client_id?: string
    customer_name?: string
    customer_email?: string
    product_id?: string
    product_title?: string
    product_icon?: string
    subject?: string
    channel?: string
    order_ref?: string
    body: string
    kind?: string
    rating?: number
  }) {
    const customerId = clip(input.customer_id, 100) || null
    const clientId = clip(input.client_id, 100) || null
    const productId = clip(input.product_id, 100) || null
    const kind = clip(input.kind, 20) || "text"

    // Диалог по этому товару уже есть? Продолжаем его. Ищем и по аккаунту,
    // и по «ключу браузера» — сообщения, отправленные до входа в кабинет,
    // не теряются, а привязываются к покупателю.
    const byCustomer = customerId
      ? await this.listConversations({ customer_id: customerId, product_id: productId })
      : []
    const byClient = clientId
      ? await this.listConversations({ client_id: clientId, product_id: productId })
      : []
    const existing = byCustomer.concat(byClient)

    let conversation = existing.find((c) => !c.hidden) || existing[0]
    if (!conversation) {
      conversation = await this.createConversations({
        customer_id: customerId,
        client_id: clientId,
        customer_name: clip(input.customer_name, 200) || null,
        customer_email: clip(input.customer_email, 200) || null,
        product_id: productId,
        product_title: clip(input.product_title, 300) || null,
        product_icon: clip(input.product_icon, 20) || null,
        subject: clip(input.subject, 300) || (clip(input.product_title, 300) || "Обращение покупателя"),
        channel: clip(input.channel, 20) || "product",
        order_ref: clip(input.order_ref, 100) || null,
        unread_seller: 0,
        unread_customer: 0,
      })
    } else {
      // диалог был скрыт покупателем — показываем снова и закрепляем за аккаунтом
      conversation = await this.updateConversations({
        id: conversation.id,
        hidden: false,
        ...(customerId && !conversation.customer_id ? { customer_id: customerId } : {}),
        ...(clientId && !conversation.client_id ? { client_id: clientId } : {}),
      })
    }

    const message = await this.addMessage(conversation.id, {
      sender: "customer",
      body: input.body,
      kind,
      rating: input.rating,
    })

    const fresh = await this.retrieveConversation(conversation.id)
    return { conversation: this.shape(fresh, [message]), message: this.toDTO(message) }
  }

  /** Действия покупателя в диалоге: отправить, прочитать, важное, закрепить, заблокировать, скрыть, отзыв, жалоба. */
  async actForCustomer(
    id: string,
    action: ThreadAction,
    input: { customer_id?: string; client_id?: string; body?: string; rating?: number }
  ) {
    const found = await this.getForCustomer(id, input)
    if (!found) return null
    const conversation = await this.retrieveConversation(id)

    if (action === "send") {
      if (conversation.blocked) return { blocked: true, conversation: found }
      const message = await this.addMessage(id, { sender: "customer", body: input.body })
      return { blocked: false, conversation: found, message: this.toDTO(message) }
    }

    if (action === "review" || action === "complaint") {
      const message = await this.addMessage(id, {
        sender: "customer",
        body: input.body,
        kind: action === "review" ? "review" : "complaint",
        rating: action === "review" ? input.rating : undefined,
      })
      return { conversation: await this.getForCustomer(id, input), message: this.toDTO(message) }
    }

    if (action === "read") {
      await this.updateConversations({ id, unread_customer: 0 })
      await this.markRead(id, "customer")
    } else if (action === "important") {
      await this.updateConversations({ id, important: !conversation.important })
    } else if (action === "pin") {
      await this.updateConversations({ id, pinned: !conversation.pinned })
    } else if (action === "block") {
      await this.updateConversations({ id, blocked: !conversation.blocked })
    } else if (action === "hide") {
      await this.updateConversations({ id, hidden: true })
    }

    const fresh = await this.retrieveConversation(id)
    const messages = await this.listMessages({ conversation_id: id }, { order: { created_at: "ASC" } })
    return { conversation: this.shape(fresh, messages) }
  }

  /** Список для админки: поиск, непрочитанные, важные. */
  async adminList(input: { q?: string; filter?: string; limit?: number }) {
    const q = clip(input.q, 200).trim().toLowerCase()
    const filter = clip(input.filter, 20) || "all"
    const limit = Math.min(Math.max(Number(input.limit) || 100, 1), 300)

    const conversations = await this.listConversations({}, { order: { last_message_at: "DESC" } as any, take: limit })
    if (!conversations.length) return { conversations: [], stats: { total: 0, unread: 0, important: 0 } }

    const ids = conversations.map((c) => c.id)
    const messages = await this.listMessages({ conversation_id: ids }, { order: { created_at: "ASC" } })

    let shaped = conversations.map((c) =>
      this.shape(c, messages.filter((m) => m.conversation_id === c.id))
    )

    if (q) {
      shaped = shaped.filter((c) => {
        const hay = [
          c.title,
          c.customer_name,
          c.customer_email,
          c.subject,
          c.preview,
          ...c.messages.map((m) => m.body),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
        return hay.includes(q)
      })
    }

    const stats = {
      total: shaped.length,
      unread: shaped.filter((c) => c.unread_seller > 0).length,
      important: shaped.filter((c) => c.important).length,
    }

    if (filter === "unread") shaped = shaped.filter((c) => c.unread_seller > 0)
    if (filter === "important") shaped = shaped.filter((c) => c.important)

    // ранжирование: непрочитанные и важные — выше
    const score = (c: any) => (c.unread_seller > 0 ? 2 : 0) + (c.important ? 1 : 0)
    shaped.sort((a, b) => score(b) - score(a) || (b.last_message_ts || 0) - (a.last_message_ts || 0))

    return { conversations: shaped, stats }
  }

  /** Один диалог для админки. */
  async adminGet(id: string) {
    const conversation = await this.retrieveConversation(id).catch(() => null)
    if (!conversation) return null
    const messages = await this.listMessages({ conversation_id: id }, { order: { created_at: "ASC" } })
    return this.shape(conversation, messages)
  }

  /** Действия продавца: ответить, отметить прочитанным, отметить важным. */
  async adminAct(id: string, action: AdminAction, input: { body?: string }) {
    const conversation = await this.retrieveConversation(id)

    if (action === "reply") {
      const message = await this.addMessage(id, { sender: "seller", body: input.body })
      return { conversation: await this.adminGet(id), message: this.toDTO(message) }
    }
    if (action === "read") {
      await this.updateConversations({ id, unread_seller: 0 })
      await this.markRead(id, "seller")
    } else if (action === "important") {
      await this.updateConversations({ id, important: !conversation.important })
    }

    return { conversation: await this.adminGet(id) }
  }

  /* ---------- внутреннее ---------- */

  private async addMessage(
    conversationId: string,
    input: { sender: string; body?: string; kind?: string; rating?: number }
  ) {
    const body = clip(input.body, 2000).trim()
    const kind = clip(input.kind, 20) || "text"
    if (!body && kind === "text") throw new Error("Пустое сообщение")
    if (kind === "review" && !body) throw new Error("Пустой отзыв")

    const conversation = await this.retrieveConversation(conversationId)
    const seller = input.sender === "seller"

    const message = await this.createMessages({
      conversation_id: conversationId,
      sender: seller ? "seller" : "customer",
      body: body || (kind === "review" ? "Отзыв" : "Жалоба"),
      kind,
      rating: input.rating == null ? null : Math.max(1, Math.min(5, Math.round(Number(input.rating) || 0))),
      read_by_seller: seller,
      read_by_customer: !seller,
    })

    const mark = ({ review: "⭐ Отзыв покупателя: ", complaint: "⚠ Жалоба: ", text: "" } as Record<string, string>)[kind] || ""
    await this.updateConversations({
      id: conversationId,
      preview: clip(mark + message.body, 300),
      last_message_at: message.created_at || new Date(),
      unread_seller: seller ? conversation.unread_seller : Number(conversation.unread_seller || 0) + 1,
      unread_customer: seller ? Number(conversation.unread_customer || 0) + 1 : conversation.unread_customer,
    })

    return message
  }

  private async markRead(conversationId: string, who: "customer" | "seller") {
    const field = who === "seller" ? "read_by_seller" : "read_by_customer"
    const messages = await this.listMessages({ conversation_id: conversationId, [field]: false } as any)
    for (const m of messages) {
      await this.updateMessages({ id: m.id, [field]: true } as any)
    }
  }

  private toDTO(m: any) {
    return { id: m.id, sender: m.sender, body: m.body, kind: m.kind, rating: m.rating, t: m.created_at }
  }

  /** Приводим запись диалога к виду, удобному лендингу и админке. */
  private shape(conversation: any, messages: any[]) {
    const last = messages.length ? messages[messages.length - 1] : null
    return {
      id: conversation.id,
      title: conversation.product_title || conversation.subject || "Диалог с продавцом",
      subject: conversation.subject || "",
      product_id: conversation.product_id || "",
      product_title: conversation.product_title || "",
      product_icon: conversation.product_icon || "💬",
      customer_id: conversation.customer_id || "",
      customer_name: conversation.customer_name || "",
      customer_email: conversation.customer_email || "",
      channel: conversation.channel || "product",
      order_ref: conversation.order_ref || "",
      preview: conversation.preview || (last ? last.body : ""),
      unread_seller: Number(conversation.unread_seller || 0),
      unread_customer: Number(conversation.unread_customer || 0),
      important: !!conversation.important,
      pinned: !!conversation.pinned,
      blocked: !!conversation.blocked,
      hidden: !!conversation.hidden,
      created_at: conversation.created_at,
      last_message_at: conversation.last_message_at,
      last_message_ts: conversation.last_message_at ? new Date(conversation.last_message_at).getTime() : 0,
      messages: messages.map((m) => ({
        id: m.id,
        sender: m.sender,
        body: m.body,
        kind: m.kind,
        rating: m.rating,
        read_by_seller: !!m.read_by_seller,
        read_by_customer: !!m.read_by_customer,
        t: m.created_at,
      })),
    }
  }
}

export default MessagesModuleService
