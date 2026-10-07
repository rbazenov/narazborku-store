import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Категория товара партнёра + список домён маршрутов для фотографий.
 *
 *   partner_product.cat        — категория витрины (Двигатель, Кузовные детали, …),
 *                                определена по названию детали при импорте фида:
 *                                нужна, чтобы товары партнёров попадали в категории
 *                                каталога и в счётчики.
 *   partner.photo_hosts        — дополнительные домены, с которых партнёр отдаёт фото.
 *                                Обычно фото лежат на своём домене партнёра (или его
 *                                поддомене) — это проверяется автоматически; список
 *                                нужен, если картинки лежат отдельно (например, на CDN).
 */
export class Migration20261007150000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "partner_product" add column if not exists "cat" text not null default '';`);
    this.addSql(`create index if not exists "IDX_partner_product_cat" on "partner_product" ("partner_id", "cat");`);
    this.addSql(`alter table "partner" add column if not exists "photo_hosts" text not null default '';`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_partner_product_cat";`);
    this.addSql(`alter table "partner_product" drop column if exists "cat";`);
    this.addSql(`alter table "partner" drop column if exists "photo_hosts";`);
  }

}
