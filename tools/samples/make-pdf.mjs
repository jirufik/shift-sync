/**
 * Синтетическая выгрузка «Henkilön työvuorolista» в PDF.
 *
 * Геометрия повторяет настоящий отчёт ORTEC (Microsoft Reporting Services):
 * A4, Helvetica 7 pt, семь колонок с теми же левыми краями, перенос текста
 * внутри узких ячеек, шапка таблицы только на первой странице, подпись внизу
 * каждой страницы. Разбор `ortec-pdf.parser.ts` опирается именно на это,
 * поэтому образец проверяет парсер так же, как настоящая выгрузка.
 *
 *   node make-pdf.mjs   → samples/pdf/report-2027-03.pdf, report-2027-04.pdf
 */
import { mkdir, writeFile } from 'node:fs/promises';

import * as mupdf from 'mupdf';

import { APRIL, MARCH, PERSON, PLAN_STATUS, UNIT } from './schedule.mjs';

const OUT = new URL('../../samples/pdf/', import.meta.url);

const PAGE_W = 595.276;
const PAGE_H = 841.89;
const SIZE = 7;

/** Левые края колонок, как в настоящем отчёте. */
const X = { date: 2, unit: 64, shiftRange: 135, vuoro: 191, note: 234, actRange: 319, activity: 376 };
/** Ширина, после которой текст ячейки переносится. */
const WRAP = { vuoro: 34, activity: 44 };

const LINE = 9; // шаг строк внутри ячейки
const ROW = 14; // высота однострочной строки таблицы
const TABLE_TOP = 116;
const PAGE2_TOP = 0;
const FOOTER_Y = 828;
const CONTENT_BOTTOM = 815;

const regular = new mupdf.Font('Helvetica');
const width = (text) =>
  [...text].reduce((sum, ch) => sum + regular.advanceGlyph(regular.encodeCharacter(ch.codePointAt(0)), 0), 0) * SIZE;

/**
 * Перенос как в отчёте: по пробелу или после дефиса, а если в строку не
 * влезает даже слово — посреди слова. Пробел, на котором произошёл перенос,
 * остаётся в конце строки (`410 ` + `Tupakka/k` + `assa`).
 */
function wrap(text, limit) {
  const lines = [];
  let rest = text;
  while (rest) {
    if (width(rest) <= limit) {
      lines.push(rest);
      break;
    }
    let fit = 1;
    while (fit < rest.length && width(rest.slice(0, fit + 1)) <= limit) fit++;
    let cut = -1;
    for (let i = fit; i > 0; i--) {
      if (rest[i - 1] === ' ' || rest[i - 1] === '-') {
        cut = i;
        break;
      }
    }
    if (cut === -1) cut = fit;
    lines.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  return lines;
}

/** Строка PDF в WinAnsi: латиница как есть, `ä`/`ö` — восьмеричными кодами. */
function pdfString(text) {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (ch === '(' || ch === ')' || ch === '\\') out += `\\${ch}`;
    else if (code < 128) out += ch;
    else if (code < 256) out += `\\${code.toString(8).padStart(3, '0')}`;
    else throw new Error(`символ вне WinAnsi: ${ch}`);
  }
  return `(${out})`;
}

class Page {
  ops = [];
  /** `top` — верх строки в координатах «сверху вниз», как у текстового слоя. */
  text(x, top, value, { bold = false, size = SIZE } = {}) {
    const baseline = PAGE_H - top - size;
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf 1 0 0 1 ${x} ${baseline.toFixed(2)} Tm ${pdfString(value)} Tj ET`);
  }
  rule(top, x0 = 0, x1 = 470, gray = 0.75) {
    const y = (PAGE_H - top).toFixed(2);
    this.ops.push(`${gray} G 0.5 w ${x0} ${y} m ${x1} ${y} l S`);
  }
}

const range = (r) => r.replace('-', ' - ');

function header(page, month) {
  page.text(X.unit, 4, 'Henkilön työvuorolista', { bold: true, size: 9 });
  page.text(X.unit, 23, 'Henkilö:', { bold: true });
  page.text(X.shiftRange, 22, PERSON);
  page.text(X.unit, 36, 'Jakso:', { bold: true });
  page.text(X.shiftRange, 36, `${month.period}* Jaksoa on muokattu. Raportti ei ole käytettävissä `);
  page.text(X.shiftRange, 45, 'valitulle jaksolle (Työvuorolista ei ole vielä saatavilla, tai valittu jakso on ');
  page.text(X.shiftRange, 54, 'pidempi kuin 1 kuukausi).');
  page.text(X.unit, 67, 'Suunnitelman ', { bold: true });
  page.text(X.unit, 76, 'tila:', { bold: true });
  page.text(X.shiftRange, 67, PLAN_STATUS[0]);
  page.text(X.shiftRange, 81, PLAN_STATUS[1]);
  page.text(X.shiftRange, 90, PLAN_STATUS[2]);

  // заголовки колонок; `Päivämäärä` и `Yksikkö` чуть ниже остальных, как в оригинале
  page.text(X.date, 104, 'Päivämäärä', { bold: true });
  page.text(X.unit, 104, 'Yksikkö', { bold: true });
  page.text(X.shiftRange, 102, 'Alkaen - Asti', { bold: true });
  page.text(X.vuoro, 102, 'Vuoro', { bold: true });
  page.text(X.note, 102, 'Selite', { bold: true });
  page.text(X.actRange, 102, 'Alkaen - Asti', { bold: true });
  page.text(X.activity, 102, 'Aktiviteetti', { bold: true });
  page.rule(113, 0, 470, 0.4);
}

function footer(page, month, index, total) {
  page.text(X.date, FOOTER_Y, month.printedAt);
  page.text(206, FOOTER_Y, 'Alihankkijan vuorohistoria', { bold: true });
  page.text(497, FOOTER_Y, `${index}/${total}`);
}

/** Раскладка одного дня: строки текста относительно верха строки и её высота. */
function layoutDay(date, entry) {
  const cells = [{ x: X.date, dy: 0, text: date }];
  if (!entry) return { cells, height: ROW };

  const [code, shiftRange, ...activities] = entry;
  cells.push({ x: X.unit, dy: 0, text: UNIT });
  cells.push({ x: X.shiftRange, dy: 0, text: range(shiftRange) });
  wrap(code, WRAP.vuoro).forEach((text, i) => cells.push({ x: X.vuoro, dy: i * LINE, text }));

  let dy = 0;
  for (const [actRange, name] of activities) {
    const lines = wrap(name, WRAP.activity);
    cells.push({ x: X.actRange, dy, text: range(actRange) });
    lines.forEach((text, i) => cells.push({ x: X.activity, dy: dy + i * LINE, text }));
    dy += ROW + (lines.length - 1) * (LINE - 1);
  }
  const vuoroLines = wrap(code, WRAP.vuoro).length;
  return { cells, height: Math.max(dy, vuoroLines * LINE + 5, ROW) };
}

function daysOf(month) {
  const last = month.lastDay ?? new Date(Date.UTC(month.year, month.month, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => i + 1);
}

function render(month) {
  const pages = [new Page()];
  header(pages[0], month);
  let top = TABLE_TOP;

  for (const day of daysOf(month)) {
    const { cells, height } = layoutDay(`${day}.${month.month}.${month.year}`, month.days[day]);
    if (top + height > CONTENT_BOTTOM) {
      pages.push(new Page());
      top = PAGE2_TOP;
    }
    const page = pages.at(-1);
    for (const cell of cells) page.text(cell.x, top + cell.dy, cell.text);
    page.rule(top + height - 2.5);
    top += height;
  }

  pages.forEach((page, i) => footer(page, month, i + 1, pages.length));

  const doc = new mupdf.PDFDocument();
  const fonts = doc.addObject({
    F1: doc.addSimpleFont(regular, 'Latin'),
    F2: doc.addSimpleFont(new mupdf.Font('Helvetica-Bold'), 'Latin'),
  });
  const resources = doc.addObject({ Font: fonts });
  for (const page of pages) {
    doc.insertPage(-1, doc.addPage([0, 0, PAGE_W, PAGE_H], 0, resources, page.ops.join('\n')));
  }
  doc.setMetaData?.('info:Title', 'Employee Schedule ESS (synthetic sample)');
  return doc.saveToBuffer('compress').asUint8Array();
}

await mkdir(OUT, { recursive: true });
for (const [name, month] of [
  ['report-2027-03.pdf', MARCH],
  ['report-2027-04.pdf', APRIL],
]) {
  await writeFile(new URL(name, OUT), render(month));
  console.log(`samples/pdf/${name}`);
}
