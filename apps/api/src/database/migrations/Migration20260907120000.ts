import { Migration } from '@mikro-orm/migrations';

/**
 * Кадр знает, откуда он взялся.
 *
 * График теперь можно выгрузить из ORTEC в PDF, и это второй вход в тот же
 * конвейер. Страницы PDF отрисовываются в картинки и живут в той же таблице,
 * что и снимки экрана, — экран проверки показывает их одинаково. Чтобы при
 * распознавании выбрать разбор (модель или текстовый слой) и добраться до
 * исходного файла, кадру нужны вид источника, путь к PDF и номер страницы.
 */
export class Migration20260907120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "screenshots" add column "source_kind" text not null default 'image';`);
    this.addSql(`alter table "screenshots" add column "source_path" text null;`);
    this.addSql(`alter table "screenshots" add column "page_index" int not null default 0;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "screenshots" drop column "page_index";`);
    this.addSql(`alter table "screenshots" drop column "source_path";`);
    this.addSql(`alter table "screenshots" drop column "source_kind";`);
  }
}
