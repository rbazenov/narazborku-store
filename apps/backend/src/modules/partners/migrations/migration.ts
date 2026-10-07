import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Таблицы партнёров с фид-ссылками и их товаров.
 *
 * partner_product хранит нашу копию каталога партнёра: уникальность пары
 * «партнёр + артикул» даёт повторному импорту обновлять товар, а не плодить дубли.
 */
export class Migration20261007120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "partner" ("id" text not null, "name" text not null default '', "city" text not null default '', "feed_url" text not null default '', "encoding" text not null default '', "separator" text not null default '', "note" text not null default '', "enabled" boolean not null default true, "last_run_at" timestamptz null, "last_ok_at" timestamptz null, "last_status" text not null default 'never', "last_error" text null, "last_total" integer not null default 0, "last_added" integer not null default 0, "last_updated" integer not null default 0, "last_offline" integer not null default 0, "last_without_price" integer not null default 0, "last_duration_ms" integer not null default 0, "active_count" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "partner_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_deleted_at" ON "partner" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "partner_product" ("id" text not null, "partner_id" text not null, "article" text not null, "title" text not null default '', "make" text not null default '', "model" text not null default '', "year" text not null default '', "body" text not null default '', "engine" text not null default '', "color" text not null default '', "part_number" text not null default '', "condition" text not null default '', "comment" text not null default '', "manufacturer" text not null default '', "price" integer null, "photos" jsonb not null default '[]'::jsonb, "attrs" jsonb not null default '{}'::jsonb, "status_text" text not null default '', "in_stock" boolean not null default true, "active" boolean not null default true, "missing_runs" integer not null default 0, "content_hash" text not null default '', "first_seen_at" timestamptz not null default now(), "last_seen_at" timestamptz not null default now(), "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "partner_product_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_partner_product_article" ON "partner_product" ("partner_id", "article");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_product_partner" ON "partner_product" ("partner_id", "active", "deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_product_last_seen" ON "partner_product" ("partner_id", "last_seen_at");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "partner_product" cascade;`);
    this.addSql(`drop table if exists "partner" cascade;`);
  }

}
