import { Migration } from '@mikro-orm/migrations';

export class Migration20260827065316 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "import_batches" ("id" uuid not null, "status" text not null default 'pending', "source_month" varchar(10) null, "stats" jsonb null, "error" text null, "created_at" timestamptz not null, "applied_at" timestamptz null, constraint "import_batches_pkey" primary key ("id"));`);
    this.addSql(`create index "import_batches_status_index" on "import_batches" ("status");`);

    this.addSql(`create table "screenshots" ("id" uuid not null, "batch_id" uuid not null, "file_path" text not null, "sha256" varchar(64) not null, "width" int not null, "height" int not null, "order_index" int not null default 0, "created_at" timestamptz not null, constraint "screenshots_pkey" primary key ("id"));`);
    this.addSql(`create index "screenshots_batch_id_index" on "screenshots" ("batch_id");`);
    this.addSql(`create index "screenshots_sha256_index" on "screenshots" ("sha256");`);

    this.addSql(`create table "recognized_rows" ("id" uuid not null, "batch_id" uuid not null, "screenshot_id" uuid not null, "kind" text not null default 'unparsed', "work_date" varchar(10) null, "weekday_text" text null, "starts_at" varchar(5) null, "ends_at" varchar(5) null, "label" text null, "location" text null, "duration_text" text null, "is_clipped" boolean not null default false, "confidence" numeric(4,3) null, "checks" jsonb not null, "sources" int not null default 0, "used_fallback" boolean not null default false, "ok" boolean not null default false, "reason" text null, "raw" jsonb null, "edited_by_user" boolean not null default false, "created_at" timestamptz not null, constraint "recognized_rows_pkey" primary key ("id"));`);
    this.addSql(`create index "recognized_rows_batch_id_index" on "recognized_rows" ("batch_id");`);
    this.addSql(`create index "recognized_rows_screenshot_id_index" on "recognized_rows" ("screenshot_id");`);

    this.addSql(`create table "shifts" ("id" uuid not null, "work_date" varchar(10) not null, "starts_at" varchar(5) not null, "ends_at" varchar(5) not null, "label" text null, "location" text null, "tz" text not null default 'Europe/Helsinki', "google_event_id" text null, "sync_state" text not null default 'pending', "sync_error" text null, "source_batch_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "shifts_pkey" primary key ("id"));`);
    this.addSql(`create index "shifts_work_date_index" on "shifts" ("work_date");`);
    this.addSql(`create index "shifts_sync_state_index" on "shifts" ("sync_state");`);
    this.addSql(`alter table "shifts" add constraint "shifts_work_date_starts_at_unique" unique ("work_date", "starts_at");`);

    this.addSql(`create table "sync_log" ("id" uuid not null, "batch_id" uuid null, "work_date" varchar(10) not null, "action" text not null, "before" jsonb null, "after" jsonb null, "google_event_id" text null, "ok" boolean not null default true, "error" text null, "created_at" timestamptz not null, constraint "sync_log_pkey" primary key ("id"));`);
    this.addSql(`create index "sync_log_work_date_index" on "sync_log" ("work_date");`);

    this.addSql(`alter table "screenshots" add constraint "screenshots_batch_id_foreign" foreign key ("batch_id") references "import_batches" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "recognized_rows" add constraint "recognized_rows_batch_id_foreign" foreign key ("batch_id") references "import_batches" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "recognized_rows" add constraint "recognized_rows_screenshot_id_foreign" foreign key ("screenshot_id") references "screenshots" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "shifts" add constraint "shifts_source_batch_id_foreign" foreign key ("source_batch_id") references "import_batches" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "sync_log" add constraint "sync_log_batch_id_foreign" foreign key ("batch_id") references "import_batches" ("id") on update cascade on delete set null;`);
  }

}
