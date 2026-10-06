import { authenticate, configureStoreSearch, defineMiddlewares } from '@medusajs/framework/http'

// The product index declares filterable `status` and `sales_channel_ids`, so
// the route narrows it to published products in the key's sales channels.
export default defineMiddlewares({
  routes: [
    {
      method: ['POST'],
      matcher: '/store/search',
      middlewares: [
        configureStoreSearch({
          allowed_indexes: {
            product: true,
          },
        }),
      ],
    },
    {
      // Переписка с продавцом: покупатель может писать и без входа в кабинет
      // (из карточки товара). Если вход выполнен — сообщения привязываются
      // к аккаунту покупателя.
      method: ['GET', 'POST'],
      matcher: '/store/messages*',
      middlewares: [
        authenticate('customer', ['bearer', 'session'], { allowUnauthenticated: true } as any),
      ],
    },
  ],
})
