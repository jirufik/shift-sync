import { Migration } from '@mikro-orm/migrations';

/**
 * Предупреждения распознавания.
 *
 * Раньше «год не прочитан, взят текущий» уходило только в журнал сервера, и
 * человек в ревью об этом не знал — а ошибка в году сдвигает весь импорт на
 * год. Теперь это сообщение едет с батчем и показывается над планом.
 */
export class Migration20260830140000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "import_batches" add column "warnings" jsonb not null default '[]'::jsonb;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "import_batches" drop column "warnings";`);
  }
}
