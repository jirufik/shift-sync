import { Migration } from '@mikro-orm/migrations';

/**
 * Причины, сохранённые до перехода на коды, переводятся в коды.
 *
 * Предыдущая миграция сохранила их строкой JSON, и `translateMessage` показывал
 * такую строку как есть — то есть по-русски даже на английском экране. Это
 * честнее, чем `msg.undefined`, но это всё равно непереведённый текст, и
 * прогон интерфейса (D-024) справедливо на него ругался.
 *
 * Набор фраз закрыт: их сочинял шлюз валидации, и все варианты перечислены
 * ниже. Числа вынимаются в подстановки регулярным выражением. Что не совпало
 * ни с одним образцом, остаётся строкой — запасной путь никуда не делся.
 */
export class Migration20260830130000 extends Migration {
  override async up(): Promise<void> {
    // строка вида «длительность 355 мин не совпала с Vuoroaika 360 мин»
    this.addSql(`
      update "recognized_rows" set "reason" = jsonb_build_object(
        'code', 'msg.duration-mismatch',
        'params', jsonb_build_object(
          'duration', (regexp_match("reason" #>> '{}', 'длительность (\\d+) мин'))[1]::int,
          'expected', (regexp_match("reason" #>> '{}', 'Vuoroaika (\\d+) мин'))[1]::int))
      where jsonb_typeof("reason") = 'string'
        and "reason" #>> '{}' ~ 'длительность \\d+ мин не совпала с Vuoroaika \\d+ мин';`);

    this.addSql(`
      update "recognized_rows" set "reason" = jsonb_build_object(
        'code', 'msg.duration-too-short',
        'params', jsonb_build_object(
          'duration', (regexp_match("reason" #>> '{}', 'длительность (\\d+) мин'))[1]::int))
      where jsonb_typeof("reason") = 'string'
        and "reason" #>> '{}' ~ 'это служебная метка';`);

    this.addSql(`
      update "recognized_rows" set "reason" = jsonb_build_object(
        'code', 'msg.duration-too-long',
        'params', jsonb_build_object(
          'duration', (regexp_match("reason" #>> '{}', 'длительность (\\d+) мин'))[1]::int))
      where jsonb_typeof("reason") = 'string'
        and "reason" #>> '{}' ~ 'выходит за разумные пределы';`);

    // «День недели не сходится: в кадре «maanantai», по календарю «tiistai»»
    this.addSql(`
      update "recognized_rows" set "reason" = jsonb_build_object(
        'code', 'msg.weekday-mismatch',
        'params', jsonb_build_object(
          'claimed', (regexp_match("reason" #>> '{}', 'в кадре «([^»]+)»'))[1],
          'real', (regexp_match("reason" #>> '{}', 'по календарю «([^»]+)»'))[1]))
      where jsonb_typeof("reason") = 'string'
        and "reason" #>> '{}' ~ 'ень недели не сходится';`);

    // «Даты 31 lauantai в этом месяце не существует»
    this.addSql(`
      update "recognized_rows" set "reason" = jsonb_build_object(
        'code', 'msg.date-not-real',
        'params', jsonb_build_object(
          'day', (regexp_match("reason" #>> '{}', 'Даты (\\d+) '))[1]::int,
          'weekday', (regexp_match("reason" #>> '{}', 'Даты \\d+ (\\S+)'))[1]))
      where jsonb_typeof("reason") = 'string'
        and "reason" #>> '{}' ~ '^Даты \\d+ ';`);

    // фразы без чисел
    for (const [pattern, code] of [
      ['арточка обрезана кромкой кадра', 'msg.clipped'],
      ['Не удалось прочитать ни левую колонку', 'msg.no-times'],
      ['ремя в левой колонке не совпало', 'msg.times-disagree'],
      ['Начало должно быть раньше окончания', 'msg.end-before-start'],
      ['Не прошло проверки', 'msg.not-validated'],
    ] as const) {
      this.addSql(`
        update "recognized_rows" set "reason" = jsonb_build_object('code', '${code}')
        where jsonb_typeof("reason") = 'string' and "reason" #>> '{}' like '%${pattern}%';`);
    }
  }

  override async down(): Promise<void> {
    // обратного пути нет: исходные формулировки не хранились, а собрать их
    // заново значило бы завести в миграции второй словарь
  }
}
