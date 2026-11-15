#!/usr/bin/env node
/**
 * Проверка на секреты и чужие данные перед коммитом.
 *
 * Репозиторий публичный, а сервис работает с рабочим графиком живого человека:
 * имя, место работы, смены, ключ сервисного аккаунта Google и ID календаря.
 * Ошибка здесь необратима: убрать файл из истории git можно, но к моменту,
 * когда это заметят, он уже скачан.
 *
 * Проверяется два разных вида беды. Первый — путь: `.env`, ключ сервисного
 * аккаунта, настоящие снимки и выгрузки графика (`private/`), загруженные кадры
 * (`storage/`) не должны попадать в индекс вообще, чем бы внутри ни оказалось.
 * Второй — содержимое: почта, ключ на шестьдесят четыре шестнадцатеричных
 * знака, токен, пароль, записанный прямо в код.
 *
 * Запуск:
 *   node scripts/scan-secrets.mjs --staged   — то, что уходит в коммит (хук)
 *   node scripts/scan-secrets.mjs            — всё, что под контролем версий
 *   node scripts/scan-secrets.mjs <файл…>    — конкретные файлы
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

/** Пути, которых в репозитории быть не должно ни при каких обстоятельствах. */
export const FORBIDDEN_PATHS = [
  { re: /(^|\/)\.env$/, why: 'файл с секретами' },
  { re: /(^|\/)\.env\.(?!example$)/, why: 'файл с секретами' },
  // `secrets/README.md` и `.gitkeep` — инструкция и заглушка, ключа в них нет
  { re: /(^|\/)secrets\/(?!README\.md$|\.gitkeep$)/, why: 'каталог с ключом сервисного аккаунта' },
  { re: /service-account[^/]*\.json$/i, why: 'ключ сервисного аккаунта Google' },
  { re: /(^|\/)private\//, why: 'настоящие снимки, выгрузки графика и личные документы' },
  { re: /(^|\/)\.scan-local\.json$/, why: 'список своих опознавателей' },
  { re: /(^|\/)backup-/, why: 'дамп базы или резервная копия' },
  // `.gitkeep` держит каталог, сами кадры — нет
  { re: /(^|\/)storage\/(?!screenshots\/\.gitkeep$)/, why: 'загруженные снимки графика' },
  { re: /\.(sql|dump|sqlite3?)$/i, why: 'дамп базы' },
  { re: /\.(pem|key|p12|pfx)$/i, why: 'закрытый ключ' },
  { re: /(^|\/)id_rsa/, why: 'закрытый ключ' },
];

/**
 * Образцы в содержимом.
 *
 * `allow` гасит заведомо безопасные совпадения: пример в документации,
 * заглушка в `.env.example`, обращение к переменной окружения. Без этого
 * проверку начнут обходить целиком, а обойдённая проверка не проверяет ничего.
 */
export const FORBIDDEN_CONTENT = [
  {
    // домен верхнего уровня буквенный: иначе под правило попадает `pnpm@10.30.3`
    name: 'адрес электронной почты',
    re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b/gi,
    /*
     * Домены `.invalid`, `.test`, `.example` и `.localhost` зарезервированы
     * RFC 2606 и не существуют: адрес в них не может принадлежать человеку,
     * и ругаться на него — значит учить обходить проверку.
     */
    allow: /example\.(com|org)|\.(invalid|test|example|localhost)\b|@fc\/|noreply@|\{\w+\}|xxxxxxxx@/i,
  },
  {
    name: 'ключ или хеш длиной от 32 шестнадцатеричных знаков',
    re: /\b[0-9a-f]{32,}\b/gi,
    allow: /^0+$/,
  },
  {
    name: 'JWT',
    re: /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g,
  },
  {
    /*
     * Значение должно быть похоже на настоящий ключ, а не на заглушку.
     *
     * Признак — длина от двенадцати знаков с цифрой внутри или от двадцати
     * четырёх вовсе. Заглушки в тестах (`'секрет'`, `'stale'`,
     * `'fresh-access-token'`) под него не попадают, а настоящий токен — да.
     * Без такой планки проверка ругалась на полсотни строк подставного сервера,
     * и на неё перестали бы смотреть.
     */
    name: 'пароль или токен, записанный значением',
    re: /\b(password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\b\s*[:=]\s*['"`](?:[^'"`\s]*\d[^'"`\s]*){1}['"`]|\b(password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\b\s*[:=]\s*['"`][^'"`\s]{24,}['"`]/gi,
    allow: /process\.env|\$\{|<[^>]+>|ЗАПОЛНИТЬ|['"`](test|example|changeme)['"`]/i,
    /** Короткое значение с цифрой — ещё не ключ; ключ длинный. */
    minValue: 12,
  },
  {
    // отдельно: пароль, записанный числом. Короткий, но это именно пароль
    name: 'пароль, записанный числом',
    re: /\b(app_?password|passwd|password)\b\s*[:=]\s*['"`]?\d{3,}['"`]?/gi,
    allow: /process\.env|\$\{|ЗАПОЛНИТЬ/i,
  },
  {
    name: 'закрытый ключ в тексте',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  },
  {
    name: 'строка подключения к базе с паролем',
    re: /\b(postgres(ql)?|mysql|mongodb):\/\/[^:\s'"]+:[^@\s'"]+@/gi,
  },
  {
    /*
     * Опознаватели конкретной установки — не секреты, но и не место им в
     * публичном репозитории: путь в домашний каталог называет машину и её
     * владельца.
     *
     * Проверка ловит вид, а не список: абсолютный путь в чужой домашний каталог
     * и адрес страницы входа Cloudflare Access. Свои домены перечисляются в
     * `.scan-local.json` — он не отслеживается, поэтому сам список наружу не
     * попадает.
     */
    name: 'путь в домашний каталог конкретной машины',
    re: /(^|[\s'"`(=:])\/home\/[a-z][\w.-]*\//gi,
    allow: /<[^>]+>|\$\{HOME\}|~\//,
  },
  {
    name: 'адрес страницы входа Cloudflare Access',
    re: /\b[\w-]+\.cloudflareaccess\.com\b/gi,
    allow: /<[^>]+>/,
  },
];

/**
 * Свои опознаватели — имена, место работы, домены, ID календаря и сервисного
 * аккаунта — из локального списка `.scan-local.json`:
 *
 *   { "identifiers": ["Имя", "Работодатель", "домен.example"] }
 *
 * Ищутся без учёта регистра как подстроки, поэтому короткое слово, которое
 * встречается внутри обычных слов, туда класть нельзя. Список лежит рядом, но
 * не отслеживается: иначе проверка, оберегающая данные от публикации, сама бы
 * их и публиковала.
 */
function localPatterns() {
  try {
    const raw = readFileSync('.scan-local.json', 'utf8');
    const own = JSON.parse(raw);
    return (own.identifiers ?? []).filter(Boolean).map((value) => ({
      name: 'опознаватель этой установки',
      re: new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
    }));
  } catch {
    return [];
  }
}

/** Двоичное и сгенерированное не читаем: смысла нет, а времени стоит. */
const SKIP_CONTENT = /\.(png|jpe?g|gif|webp|svg|ico|ttf|woff2?|pdf|zip|gz|mp4)$|pnpm-lock\.yaml$/i;

/** Крупный файл в исходниках — почти всегда чьи-то данные, а не код. */
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Строку можно осознанно пометить — но повод должен быть написан рядом.
 *
 * Пометка ищется и на самой строке, и на двух предыдущих: длинный ключ с
 * хвостом-комментарием не читается, объяснение естественнее ставить сверху.
 */
const ALLOW_MARK = /scan-secrets:\s*allow/;
const marked = (lines, index) =>
  ALLOW_MARK.test(lines[index]) ||
  ALLOW_MARK.test(lines[index - 1] ?? '') ||
  ALLOW_MARK.test(lines[index - 2] ?? '');

export function scanFile(file) {
  const found = [];

  for (const rule of FORBIDDEN_PATHS) {
    if (rule.re.test(file)) found.push(`${file}: ${rule.why} — такому файлу в репозитории не место`);
  }

  let size = 0;
  try {
    size = statSync(file).size;
  } catch {
    return found; // файл удалён этим же коммитом
  }

  if (size > MAX_BYTES) {
    found.push(`${file}: ${Math.round(size / 1024)} КБ — слишком крупно для исходника, похоже на данные`);
    return found;
  }
  if (SKIP_CONTENT.test(file)) return found;

  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return found;
  }
  // нулевой байт — признак двоичного файла, читать его построчно незачем
  if (text.includes(' ')) return found;

  const lines = text.split('\n');
  for (const rule of [...FORBIDDEN_CONTENT, ...localPatterns()]) {
    for (const [index, line] of lines.entries()) {
      if (marked(lines, index)) continue;
      for (const hit of line.match(rule.re) ?? []) {
        if (rule.allow?.test(hit) || rule.allow?.test(line)) continue;
        if (rule.minValue) {
          const value = hit.match(/['"`]([^'"`]*)['"`]\s*$/)?.[1] ?? '';
          if (value.length < rule.minValue) continue;
        }
        found.push(`${file}:${index + 1}: ${rule.name} — «${hit.slice(0, 48)}»`);
      }
    }
  }
  return found;
}

function filesToCheck() {
  const args = process.argv.slice(2).filter((arg) => arg !== '--staged');
  if (args.length > 0) return args;

  const staged = process.argv.includes('--staged');
  const out = staged
    ? execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
    : execFileSync('git', ['ls-files']);
  return out.toString().split('\n').filter(Boolean);
}

// при импорте из теста ничего не запускаем
if (process.argv[1]?.endsWith('scan-secrets.mjs')) {
  const problems = [...new Set(filesToCheck().flatMap(scanFile))];

  if (problems.length === 0) {
    console.log('Секретов и чужих данных не найдено.');
  } else {
    console.error('\nКоммит остановлен: в файлах есть то, чему не место в публичном репозитории.\n');
    for (const problem of problems) console.error(`  ${problem}`);
    console.error(
      '\nЧто делать: убрать данные из файла, а сам файл — в .gitignore, если он с данными целиком.\n' +
        'Строку, безопасную по существу, можно пометить комментарием «scan-secrets: allow» —\n' +
        'но рядом должно быть написано, почему она безопасна.\n',
    );
    process.exit(1);
  }
}
