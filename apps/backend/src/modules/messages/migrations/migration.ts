import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261006145641 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "conversation" ("id" text not null, "customer_id" text null, "client_id" text null, "customer_name" text null, "customer_email" text null, "product_id" text null, "product_title" text null, "product_icon" text null, "subject" text null, "channel" text not null default 'product', "order_ref" text null, "preview" text null, "last_message_at" timestamptz null, "unread_seller" integer not null default 0, "unread_customer" integer not null default 0, "important" boolean not null default false, "pinned" boolean not null default false, "blocked" boolean not null default false, "hidden" boolean not null default false, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "conversation_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_conversation_deleted_at" ON "conversation" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "message" ("id" text not null, "conversation_id" text not null, "sender" text not null default 'customer', "body" text not null, "kind" text not null default 'text', "rating" integer null, "read_by_seller" boolean not null default false, "read_by_customer" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "message_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_message_deleted_at" ON "message" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "conversation" cascade;`);

    this.addSql(`drop table if exists "message" cascade;`);
  }

}
