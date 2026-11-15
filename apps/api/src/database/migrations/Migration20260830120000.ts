import { Migration } from '@mikro-orm/migrations';

/**
 * Причины и ошибки становятся сообщениями: код и подстановки вместо готовой
 * русской фразы (D-023). Колонки переезжают с `text` на `jsonb`.
 *
 * Уже сохранённый текст не выбрасывается: `to_jsonb` кладёт его как строку
 * JSON, а `translateMessage` строку показывает как есть. Строки, распознанные
 * до перехода, останутся русскими на любом языке — переписать их не во что,
 * зато они не превратятся в `msg.undefined` на месте причины.
 */
export class Migration20260830120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "recognized_rows" alter column "reason" type jsonb using to_jsonb("reason");`,
    );
    this.addSql(
      `alter table "import_batches" alter column "error" type jsonb using to_jsonb("error");`,
    );
    this.addSql(`alter table "sync_log" alter column "error" type jsonb using to_jsonb("error");`);
    this.addSql(
      `alter table "shifts" alter column "sync_error" type jsonb using to_jsonb("sync_error");`,
    );
  }

  override async down(): Promise<void> {
    // обратно текстом: у сообщения-объекта останется его JSON, у строки — она сама
    this.addSql(
      `alter table "recognized_rows" alter column "reason" type text using ("reason" #>> '{}');`,
    );
    this.addSql(
      `alter table "import_batches" alter column "error" type text using ("error" #>> '{}');`,
    );
    this.addSql(`alter table "sync_log" alter column "error" type text using ("error" #>> '{}');`);
    this.addSql(
      `alter table "shifts" alter column "sync_error" type text using ("sync_error" #>> '{}');`,
    );
  }
}
