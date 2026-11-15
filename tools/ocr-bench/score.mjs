import { readFile } from 'node:fs/promises';
import { parseScreenshot, validateRow, fmt } from './parser.mjs';

/** Эталон для синтетических кадров `samples/ess/` (график — `tools/samples/schedule.mjs`). */
const GT = {
  '2027-03-07': '07:00-14:00',
  '2027-03-08': '10:00-16:30',
  '2027-03-09': '09:00-17:00',
  '2027-03-10': 'NO_SHIFT',
  '2027-03-11': 'REVIEW',     // TES V — не смена: не создавать, показать в ревью
  '2027-03-12': '08:30-15:00',
  '2027-03-13': '12:00-20:00',
  '2027-03-14': 'NO_SHIFT',
  '2027-03-15': '07:00-14:00',
};

const file = process.argv[2] ?? 'raw-v5-salvage.json';
const dump = JSON.parse(await readFile(file, 'utf8'));

const merged = new Map();   // date -> {res, from}
const attention = [];

// год есть только в шапке месяца; если в каком-то кадре её не прочитали — берём из соседнего
const years = Object.values(dump).map(d => parseScreenshot(d.items, 1280).month?.year).filter(Boolean);
const fallbackYear = years[0] ?? new Date().getFullYear();

for (const [name, d] of Object.entries(dump)) {
  const { rows, month } = parseScreenshot(d.items, 1280);
  for (const row of rows) {
    const v = validateRow(row, month?.year ?? fallbackYear);
    const rec = { ...v, from: name };
    if (!v.ok) { attention.push(rec); continue; }
    if (v.kind === 'non_work_marker') { attention.push(rec); continue; }
    const prev = merged.get(v.date);
    if (prev && (prev.startMin !== v.startMin || prev.endMin !== v.endMin || prev.kind !== v.kind)) {
      attention.push({ ...rec, reason: `конфликт с ${prev.from}` });
      continue;
    }
    merged.set(v.date, rec);
  }
}

const dates = [...new Set([...Object.keys(GT), ...merged.keys()])].sort();
let hit = 0, miss = 0;
console.log(`\n${'дата'.padEnd(12)} ${'эталон'.padEnd(13)} ${'получено'.padEnd(13)} ист  ${'вердикт'}`);
console.log('─'.repeat(74));
for (const date of dates) {
  const want = GT[date] ?? '—';
  const got = merged.get(date);
  let gotStr = '—', src = '-';
  if (got) {
    gotStr = got.kind === 'no_shift' ? 'NO_SHIFT' : `${fmt(got.startMin)}-${fmt(got.endMin)}`;
    src = got.kind === 'no_shift' ? '1' : `${got.sources}${got.usedFallback ? '*' : ''}`;
  }
  const inAttn = attention.some(a => a.date === date);
  const ok = want === 'REVIEW' ? (!got && inAttn) : gotStr === want;
  if (want === 'REVIEW') gotStr = inAttn ? 'REVIEW' : gotStr;
  if (ok) hit++; else miss++;
  console.log(`${date.padEnd(12)} ${want.padEnd(13)} ${gotStr.padEnd(13)} ${String(src).padEnd(4)} ${ok ? '✓' : '✗ РАСХОЖДЕНИЕ'}`);
}
console.log('─'.repeat(74));
console.log(`Совпало: ${hit}/${dates.length}   Расхождений: ${miss}`);
console.log(`* = время восстановлено из заголовка карточки, левая колонка неполная\n`);

if (attention.length) {
  console.log('«Требует внимания» (в календарь не пойдёт, покажется в ревью):');
  for (const a of attention) {
    const f = Object.entries(a.checks ?? {}).filter(([, v]) => v === false).map(([k]) => k);
    console.log(`  ${a.date ?? '?'}  kind=${a.kind}  ${a.label ? JSON.stringify(a.label) + '  ' : ''}` +
                `${a.startMin !== undefined ? fmt(a.startMin) + '-' + fmt(a.endMin) + '  ' : ''}` +
                `упало: [${f.join(', ') || '—'}]${a.reason ? '  ' + a.reason : ''}  (${a.from})`);
  }
  console.log();
}
