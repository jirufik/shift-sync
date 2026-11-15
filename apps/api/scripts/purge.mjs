/**
 * Удаление того, что создал сервис: события в Google Календаре, записи в базе
 * и файлы кадров. Нужно, чтобы пройти сценарий с чистого листа или отменить
 * неудачный импорт, не разбирая всё руками.
 *
 * Фильтр задаётся по рабочим датам смен: под удаление попадает всё, что сервис
 * создал для этих дат. Чужое не трогается никогда — события выбираются по метке
 * app=<GCAL_APP_TAG> фильтром на стороне Google, и метка проверяется ещё раз
 * перед удалением каждого события.
 *
 * Без --yes это сухой прогон: печатает, что попадёт под удаление, и выходит.
 *
 *   pnpm --filter @fc/api run purge -- --all
 *   pnpm --filter @fc/api run purge -- --all --yes
 *   pnpm --filter @fc/api run purge -- --from=2027-03-01 --to=2027-03-30 --yes
 *   pnpm --filter @fc/api run purge -- --date=2027-03-07 --date=2027-03-08 --calendar --yes
 */
import { readFileSync, existsSync } from 'node:fs';
import { readdir, unlink, rmdir } from 'node:fs/promises';
import { resolve, join, relative, sep } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { google } from 'googleapis';
import pg from 'pg';

loadEnv({ path: resolve(process.cwd(), '.env'), quiet: true });
loadEnv({ path: resolve(process.cwd(), '../../.env'), quiet: true });

const ok = (s) => `\x1b[32m✓\x1b[0m ${s}`;
const no = (s) => `\x1b[31m✗\x1b[0m ${s}`;
const dim = (s) => `\x1b[90m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const head = (s) => `\n${bold(s)}\n${dim('─'.repeat(64))}`;

// ── разбор аргументов ───────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (name) => argv.includes(`--${name}`);
const one = (name) => {
  const found = argv.filter((a) => a.startsWith(`--${name}=`));
  return found.length ? found[found.length - 1].slice(name.length + 3) : null;
};
const many = (name) => argv.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function usage(message) {
  if (message) console.log(`\n${no(message)}`);
  console.log(`
${bold('Удаление созданного сервисом')}

  pnpm --filter @fc/api run purge -- ${dim('<фильтр> [область] [--yes]')}

${bold('Фильтр')} — какие рабочие даты попадают под удаление. Обязателен.
  --all                 все даты без ограничения
  --from=2027-03-01     с этой даты включительно
  --to=2027-03-30       по эту дату включительно
  --date=2027-03-07     конкретная дата, можно повторять

  --from/--to/--date складываются: дата подходит, если совпала хоть с одним.

${bold('Отдельно: одна загрузка')}
  --batches             показать список загрузок и выйти
  --batch=<id>          убрать конкретную загрузку из истории: её кадры и
                        распознанные строки. Смены и события в календаре
                        остаются — их могла подтвердить и другая загрузка;
                        для них используйте фильтр по датам.
                        Не сочетается с фильтром по датам и с --calendar.

${bold('Область')} — что чистить. По умолчанию и календарь, и база.
  --calendar            только события в Google Календаре
  --db                  только база; файлы кадров удаляются вместе со своими
                        записями, иначе в базе остались бы ссылки в никуда

${bold('Режим')}
  ${dim('(без --yes)')}           сухой прогон: показать, что удалится, и выйти
  --yes                 выполнить удаление
`);
  process.exit(message ? 1 : 0);
}

if (has('help') || has('h') || argv.length === 0) usage();

const all = has('all');
const batchIds = many('batch');
const listBatches = has('batches');
const from = one('from');
const to = one('to');
const dates = many('date');
const apply = has('yes');

for (const [name, v] of [['from', from], ['to', to], ...dates.map((d) => ['date', d])]) {
  if (v !== null && !DATE_RE.test(v)) usage(`--${name}=${v} — ожидается дата вида ГГГГ-ММ-ДД`);
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
for (const id of batchIds) if (!UUID_RE.test(id)) usage(`--batch=${id} — ожидается идентификатор загрузки (uuid), список: --batches`);
if (batchIds.length && (all || from || to || dates.length)) usage('--batch не сочетается с фильтром по датам');
if (batchIds.length && has('calendar')) usage('--batch работает только с базой: события в календаре им не выбираются');
if (!listBatches && !batchIds.length && !all && !from && !to && dates.length === 0) usage('не задан фильтр: нужен --all, --from/--to, --date или --batch');
if (all && (from || to || dates.length)) usage('--all нельзя сочетать с сужающими фильтрами');
if (from && to && from > to) usage(`--from=${from} позже, чем --to=${to}`);

const onlyCalendar = has('calendar') && !has('db');
const onlyDb = (has('db') && !has('calendar')) || batchIds.length > 0;
const doCalendar = !onlyDb;
const doDb = !onlyCalendar;

/** Подходит ли рабочая дата под фильтр. `null` — дата не распозналась, её берём только при --all. */
const matches = (date) => {
  if (all) return true;
  if (!date) return false;
  if (dates.includes(date)) return true;
  if (!from && !to) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
};

const filterLabel = batchIds.length
  ? `загрузки ${batchIds.join(', ')}`
  : all
  ? 'все даты'
  : [
      dates.length ? `даты ${dates.join(', ')}` : null,
      from || to ? `диапазон ${from ?? '…'} … ${to ?? '…'}` : null,
    ].filter(Boolean).join(' + ');

const client = new pg.Client({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5481),
  database: process.env.DB_NAME ?? 'fc_shift_sync',
  user: process.env.DB_USER ?? 'fc_admin',
  password: process.env.DB_PASSWORD ?? 'fc_admin',
});

const batchRows = async () =>
  (
    await client.query(`
      select b.id, b.status, b.created_at,
             count(distinct r.id)::int as rows,
             count(distinct s.id)::int as shots,
             min(r.work_date) as first_date,
             max(r.work_date) as last_date
        from import_batches b
        left join recognized_rows r on r.batch_id = b.id
        left join screenshots s on s.batch_id = b.id
       group by b.id
       order by b.created_at
    `)
  ).rows;

const connect = async () => {
  try {
    await client.connect();
  } catch (e) {
    console.log(`\n  ${no(`база недоступна: ${e.message}`)}\n`);
    process.exit(1);
  }
};

// --batches отвечает сразу: ни фильтра, ни календаря ему не нужно
if (listBatches) {
  await connect();
  console.log(head('Загрузки'));
  const list = await batchRows();
  console.log(`  всего: ${list.length}`);
  for (const b of list) {
    const when = new Date(b.created_at).toISOString().replace('T', ' ').slice(0, 16);
    const span = b.first_date ? `${b.first_date} … ${b.last_date}` : 'без дат';
    console.log(`    ${b.id}  ${when}  ${b.status.padEnd(9)} строк ${b.rows}, кадров ${b.shots}  ${dim(span)}`);
  }
  console.log(`\n  Убрать одну: ${dim('--batch=<id> --yes')}\n`);
  await client.end();
  process.exit(0);
}

console.log(head('Фильтр'));
console.log(`  ${filterLabel}`);
console.log(`  область: ${[doCalendar && 'календарь', doDb && 'база и кадры'].filter(Boolean).join(' + ')}`);
console.log(`  режим:   ${apply ? bold('удаление') : 'сухой прогон'}`);

// ── календарь ───────────────────────────────────────────────────────────────
const appTag = process.env.GCAL_APP_TAG ?? 'fc-shift-sync';
let calendarTargets = [];
let calendar = null;
const calendarId = process.env.GCAL_CALENDAR_ID ?? '';

if (doCalendar) {
  console.log(head('Календарь'));
  const keyPath = resolve(process.cwd(), process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '');
  if (!calendarId || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON || !existsSync(keyPath)) {
    console.log(`  ${no('Google не настроен — пропускаю (нужны GCAL_CALENDAR_ID и ключ сервисного аккаунта)')}`);
  } else {
    const key = JSON.parse(readFileSync(keyPath, 'utf8'));
    const auth = new google.auth.JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: ['https://www.googleapis.com/auth/calendar.events'],
    });
    calendar = google.calendar({ version: 'v3', auth });

    const events = [];
    let pageToken;
    do {
      const res = await calendar.events.list({
        calendarId,
        privateExtendedProperty: [`app=${appTag}`],
        showDeleted: false,
        singleEvents: true,
        maxResults: 250,
        pageToken,
      });
      events.push(...(res.data.items ?? []));
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    const dateOf = (e) =>
      e.extendedProperties?.private?.workDate ?? (e.start?.dateTime ?? e.start?.date ?? '').slice(0, 10) ?? null;

    calendarTargets = events.filter((e) => matches(dateOf(e)));
    console.log(`  событий с меткой app=${appTag}: ${events.length}, под фильтр попало: ${bold(String(calendarTargets.length))}`);
    for (const e of calendarTargets.slice(0, 20)) console.log(dim(`    ${dateOf(e)}  «${e.summary ?? ''}»`));
    if (calendarTargets.length > 20) console.log(dim(`    … и ещё ${calendarTargets.length - 20}`));
  }
}

// ── база и кадры ────────────────────────────────────────────────────────────
let plan = null;
if (doDb) {
  console.log(head('База и кадры'));
  await connect();

  let knownDates, undatedRows, shifts, rows, logs, batches, shots;
  try {
  if (batchIds.length) {
    const list = await batchRows();
    const missing = batchIds.filter((id) => !list.some((b) => b.id === id));
    if (missing.length) {
      console.log(`  ${no(`загрузка не найдена: ${missing.join(', ')}`)}`);
      console.log(dim('  список доступных: --batches'));
      await client.end();
      process.exit(1);
    }
    const picked = list.filter((b) => batchIds.includes(b.id));
    knownDates = [];
    undatedRows = 0;
    shifts = 0;
    logs = 0;
    batches = picked;
    rows = picked.reduce((sum, b) => sum + b.rows, 0);
    shots = (
      await client.query('select file_path from screenshots where batch_id = any($1)', [batchIds])
    ).rows.map((r) => r.file_path);
    for (const b of picked) {
      console.log(`  ${b.id}  строк ${b.rows}, кадров ${b.shots}  ${dim(`${b.first_date ?? '—'} … ${b.last_date ?? '—'}`)}`);
    }
    console.log(`  смены и события в календаре не трогаются`);
  } else {
  knownDates = (
    await client.query(`
      select distinct work_date from shifts where work_date is not null
      union select distinct work_date from recognized_rows where work_date is not null
      union select distinct work_date from sync_log where work_date is not null
    `)
  ).rows.map((r) => r.work_date).filter((d) => matches(d));

  // строки без распознанной даты выносим отдельно: они уходят только при --all
  undatedRows = all
    ? Number((await client.query('select count(*)::int c from recognized_rows where work_date is null')).rows[0].c)
    : 0;

  const count = async (sql, params) => Number((await client.query(sql, params)).rows[0].c);
  shifts = await count('select count(*)::int c from shifts where work_date = any($1)', [knownDates]);
  rows = (await count('select count(*)::int c from recognized_rows where work_date = any($1)', [knownDates])) + undatedRows;
  logs = await count('select count(*)::int c from sync_log where work_date = any($1)', [knownDates]);

  // батч уходит, когда после чистки от него не остаётся ни одной распознанной строки
  batches = (
    await client.query(
      `select b.id, b.status, b.created_at
         from import_batches b
        where not exists (
              select 1 from recognized_rows r
               where r.batch_id = b.id
                 and not (r.work_date = any($1) or ($2 and r.work_date is null))
        )`,
      [knownDates, all],
    )
  ).rows;

  shots = (
    await client.query(
      'select file_path from screenshots where batch_id = any($1)',
      [batches.map((b) => b.id)],
    )
  ).rows.map((r) => r.file_path);

  }
  } catch (e) {
    console.log(`  ${no(`запрос к базе не удался: ${e.message}`)}`);
    await client.end();
    process.exit(1);
  }

  plan = { knownDates, shifts, rows, logs, batches, shots, undatedRows };
  if (!batchIds.length) {
  console.log(`  дат под фильтром: ${knownDates.length}${knownDates.length ? dim(` (${knownDates.slice(0, 6).join(', ')}${knownDates.length > 6 ? ', …' : ''})`) : ''}`);
  console.log(`  смен: ${bold(String(shifts))} · распознанных строк: ${bold(String(rows))} · записей лога: ${bold(String(logs))}`);
  console.log(`  загрузок целиком: ${bold(String(batches.length))} · их кадров: ${bold(String(shots.length))}`);
  }
}

// ── выполнение ──────────────────────────────────────────────────────────────
if (!apply) {
  console.log(head('Сухой прогон'));
  console.log('  Ничего не удалено. Повторите ту же команду с --yes.\n');
  if (doDb) await client.end();
  process.exit(0);
}

console.log(head('Удаляю'));

if (doCalendar && calendar) {
  let removed = 0;
  for (const e of calendarTargets) {
    if (e.extendedProperties?.private?.app !== appTag) {
      console.log(`  ${no(`пропуск, метка не совпала: ${e.id}`)}`);
      continue;
    }
    await calendar.events.delete({ calendarId, eventId: e.id });
    removed += 1;
  }
  console.log(`  ${ok(`календарь: удалено событий ${removed} из ${calendarTargets.length}`)}`);
}

if (doDb && plan) {
  const { knownDates, batches } = plan;
  await client.query('begin');
  try {
    await client.query('delete from sync_log where work_date = any($1)', [knownDates]);
    await client.query('delete from shifts where work_date = any($1)', [knownDates]);
    await client.query('delete from recognized_rows where work_date = any($1)', [knownDates]);
    if (all) await client.query('delete from recognized_rows where work_date is null');
    if (batches.length) {
      // screenshots и оставшиеся строки уйдут каскадом по внешнему ключу
      await client.query('delete from import_batches where id = any($1)', [batches.map((b) => b.id)]);
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    console.log(`  ${no(`база: откат, ничего не удалено — ${e.message}`)}`);
    await client.end();
    process.exit(1);
  }
  console.log(`  ${ok('база: записи удалены')}`);

  // ── файлы: сносим только те, на которые не осталось ни одной ссылки ──────
  const storageDir = resolve(process.cwd(), process.env.STORAGE_DIR ?? '../../storage/screenshots');
  // У страницы PDF файлов два: отрисованная картинка и исходная выгрузка, из
  // которой её разбирают. Ссылкой считаются оба — иначе оригинал пропал бы
  // из-под живого импорта, потому что в `file_path` его нет.
  const referenced = new Set(
    (
      await client.query(`
        select file_path from screenshots
        union
        select source_path from screenshots where source_path is not null
      `)
    ).rows.map((r) => r.file_path),
  );

  const walk = async (dir) => {
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...(await walk(full)));
      else if (!entry.name.startsWith('.')) out.push(full);
    }
    return out;
  };

  let files = [];
  try {
    files = await walk(storageDir);
  } catch {
    console.log(`  ${dim(`хранилище ${storageDir} недоступно — файлы пропущены`)}`);
  }

  let removedFiles = 0;
  for (const file of files) {
    const rel = relative(storageDir, file).split(sep).join('/');
    if (referenced.has(rel)) continue;
    await unlink(file);
    removedFiles += 1;
  }
  // подчищаем опустевшие каталоги по дням
  try {
    for (const entry of await readdir(storageDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(storageDir, entry.name);
      if ((await readdir(dir)).length === 0) await rmdir(dir);
    }
  } catch { /* каталога может не быть */ }

  console.log(`  ${ok(`кадры: удалено файлов ${removedFiles}, осталось под ссылками ${referenced.size}`)}`);
}

if (doDb) await client.end();

if (onlyCalendar) {
  console.log(`\n  ${dim('Чистился только календарь: в базе остались смены со ссылками на удалённые события.')}`);
}
console.log('');
