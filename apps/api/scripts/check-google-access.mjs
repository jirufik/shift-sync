/**
 * Аудит доступа сервисного аккаунта.
 *
 * Показывает, что сервис МОЖЕТ и, главное, чего он НЕ может. Запускать после
 * настройки Google и всякий раз, когда возникает сомнение в изоляции доступа.
 *
 *   pnpm --filter @fc/api run check:google
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { google } from 'googleapis';

loadEnv({ path: resolve(process.cwd(), '.env'), quiet: true });
loadEnv({ path: resolve(process.cwd(), '../../.env'), quiet: true });

/** Единственная область, которую запрашивает сервис. */
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

const keyFile = resolve(process.cwd(), process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '');
const calendarId = process.env.GCAL_CALENDAR_ID ?? '';
const appTag = process.env.GCAL_APP_TAG ?? 'fc-shift-sync';

const ok = (s) => `\x1b[32m✓\x1b[0m ${s}`;
const no = (s) => `\x1b[31m✗\x1b[0m ${s}`;
const dim = (s) => `\x1b[90m${s}\x1b[0m`;

console.log('\n── Проверка ключа ──────────────────────────────────────────────');
if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  console.log(no('GOOGLE_SERVICE_ACCOUNT_JSON не задан в .env'));
  process.exit(1);
}
if (!existsSync(keyFile)) {
  console.log(no(`файл ключа не найден: ${keyFile}`));
  process.exit(1);
}

let key;
try {
  key = JSON.parse(readFileSync(keyFile, 'utf8'));
} catch (e) {
  console.log(no(`ключ не читается как JSON: ${e.message}`));
  process.exit(1);
}
if (key.type !== 'service_account') {
  console.log(no(`это не ключ сервисного аккаунта (type=${key.type})`));
  process.exit(1);
}
console.log(ok(`ключ на месте, аккаунт: ${key.client_email}`));
console.log(dim(`  проект: ${key.project_id}`));

if (!calendarId) {
  console.log(no('GCAL_CALENDAR_ID не задан в .env'));
  process.exit(1);
}
console.log(ok(`целевой календарь: ${calendarId}`));

const auth = new google.auth.GoogleAuth({ keyFile, scopes: [SCOPE] });
const calendar = google.calendar({ version: 'v3', auth });

const fails = [];

// ── что сервис ДОЛЖЕН уметь ────────────────────────────────────────────────
console.log('\n── Что сервис умеет ────────────────────────────────────────────');
try {
  const res = await calendar.events.list({
    calendarId,
    maxResults: 1,
    timeMin: new Date(Date.UTC(2000, 0, 1)).toISOString(),
  });
  console.log(ok('читает события целевого календаря'));
} catch (e) {
  console.log(no(`НЕ читает целевой календарь: ${e.message}`));
  console.log(dim('  проверьте, что календарь открыт на адрес сервисного аккаунта'));
  fails.push('нет доступа к целевому календарю');
}

try {
  // считаем постранично: при maxResults=1 Google вправе вернуть пустую страницу,
  // имея следующие, и «0» тогда врёт — а этому скрипту верят на слово
  let own = 0;
  let pageToken;
  do {
    const res = await calendar.events.list({
      calendarId,
      privateExtendedProperty: [`app=${appTag}`],
      showDeleted: false,
      singleEvents: true,
      maxResults: 250,
      pageToken,
      timeMin: new Date(Date.UTC(2000, 0, 1)).toISOString(),
    });
    own += res.data.items?.length ?? 0;
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  console.log(ok(`видит свои события по метке app=${appTag}: ${own}`));
} catch (e) {
  console.log(no(`выборка по метке не работает: ${e.message}`));
  fails.push('выборка по метке');
}

// ── чего сервис НЕ должен мочь ─────────────────────────────────────────────
console.log('\n── Чего сервис НЕ может (так и должно быть) ────────────────────');

const mustFail = [
  {
    what: 'получить список всех календарей аккаунта',
    run: () => calendar.calendarList.list({ maxResults: 1 }),
  },
  {
    what: 'создать новый календарь',
    run: () => calendar.calendars.insert({ requestBody: { summary: 'проверка изоляции' } }),
  },
  {
    what: 'изменить права доступа к календарю',
    run: () => calendar.acl.list({ calendarId, maxResults: 1 }),
  },
  {
    what: 'обратиться к Google Drive',
    run: () => google.drive({ version: 'v3', auth }).files.list({ pageSize: 1 }),
  },
];

for (const check of mustFail) {
  try {
    await check.run();
    console.log(no(`ДОСТУП ЕСТЬ: ${check.what} — это лишнее право`));
    fails.push(check.what);
  } catch (e) {
    const code = e.code ?? e.status ?? '?';
    console.log(ok(`не может: ${check.what} ${dim(`(${code})`)}`));
  }
}

// ── попытка достать чужой календарь, если указан ───────────────────────────
const other = process.argv[2];
if (other) {
  console.log('\n── Проверка чужого календаря ───────────────────────────────────');
  try {
    await calendar.events.list({ calendarId: other, maxResults: 1 });
    console.log(no(`ДОСТУП ЕСТЬ к ${other} — этот календарь тоже расшарен, уберите доступ`));
    fails.push(`доступ к постороннему календарю ${other}`);
  } catch (e) {
    console.log(ok(`не видит ${other} ${dim(`(${e.code ?? e.status ?? '?'})`)}`));
  }
}

// ── итог ───────────────────────────────────────────────────────────────────
console.log('\n────────────────────────────────────────────────────────────────');
if (fails.length === 0) {
  console.log(ok('Изоляция в порядке: доступ только к одному календарю, к другим сервисам Google — нет.\n'));
  process.exit(0);
}
console.log(no(`Проблемы (${fails.length}):`));
for (const f of fails) console.log(`   · ${f}`);
console.log('');
process.exit(1);
