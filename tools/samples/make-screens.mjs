/**
 * Синтетические снимки экрана «Työvuorolista» из мобильного приложения ESS.
 *
 * Страница рисуется в HTML и снимается Playwright в размер, в котором снимки
 * обычно доходят до сервиса через мессенджер: 590×1280, JPEG. Вёрстка
 * повторяет то, на что опирается разбор `ortec-ess.parser.ts`: шапка месяца,
 * заголовки дней, карточка с колонкой времени слева (x < 140), код смены,
 * место работы и строка `Vuoroaika`. Ни логотипов, ни настоящих данных.
 *
 *   node make-screens.mjs   → samples/ess/screen-1.jpg … screen-3.jpg
 *
 * Первый раз: pnpm exec playwright install chromium
 */
import { mkdir, readFile } from 'node:fs/promises';

import { chromium } from 'playwright';

import { MARCH, SCREENS, UNIT } from './schedule.mjs';

const OUT = new URL('../../samples/ess/', import.meta.url);
const WIDTH = 590;
const HEIGHT = 1280;

const WEEKDAYS = ['sunnuntai', 'maanantai', 'tiistai', 'keskiviikko', 'torstai', 'perjantai', 'lauantai'];
const MONTH = 'maaliskuuta';

const toMin = (t) => {
  const [h, m] = t.split('.').map(Number);
  return h * 60 + m;
};
const clock = (t) => t.replace('.', ':');
const hours = (min) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ja ${m} min` : `${h} h`;
};

function card(day) {
  const entry = MARCH.days[day];
  if (!entry) {
    return `<div class="card empty"><span class="home">⌂</span>Sinulla ei ole työvuoroa tänä päivänä</div>`;
  }
  const [code, range, ...activities] = entry;
  const [start, end] = range.split('-');
  if (code === 'TES V') {
    return `<div class="card">
      <div class="times"><b>${clock(start)}</b><b>${clock(end)}</b></div>
      <div class="bar magenta"></div>
      <div class="body"><div class="title">TES V</div><div class="place">${UNIT}</div></div>
      <span class="moon">☾</span></div>`;
  }
  const shift = toMin(end) - toMin(start);
  const pause = activities
    .filter(([, name]) => name === 'Lepoaika')
    .reduce((sum, [r]) => sum + toMin(r.split('-')[1]) - toMin(r.split('-')[0]), 0);
  const color = day % 2 ? 'blue' : 'magenta';
  return `<div class="card">
    <div class="times"><b>${clock(start)}</b><b>${clock(end)}</b></div>
    <div class="bar ${color}"></div>
    <div class="body">
      <div class="title">${code}</div>
      <div class="place">${UNIT}</div>
      <div class="dur">Vuoroaika: ${hours(shift)}, Työaika: ${hours(shift - pause)}</div>
    </div></div>`;
}

function day(d) {
  const weekday = WEEKDAYS[new Date(Date.UTC(MARCH.year, MARCH.month - 1, d)).getUTCDay()];
  return `<section class="day" id="d${d}">
    <h2><span class="dot"></span>${weekday}, ${MONTH} ${d}<span class="chev">›</span></h2>
    ${card(d)}
  </section>`;
}

const allDays = SCREENS.frames.flat();

/** Шрифт берём из интерфейса сервиса, чтобы кадры не зависели от шрифтов системы. */
const inter = (await readFile(new URL('../../apps/web/public/fonts/inter-latin.woff2', import.meta.url))).toString('base64');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Inter; src: url(data:font/woff2;base64,${inter}) format('woff2'); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; background: #f4f5f9;
  font-family: Inter, Arial, sans-serif; color: #333; position: relative; }
.status { height: 80px; display: flex; align-items: center; justify-content: space-between; padding: 0 44px; background: #fff;
  font: 600 26px Inter, Arial; }
.status .icons { font-size: 18px; letter-spacing: 6px; }
.appbar { height: 90px; display: flex; align-items: center; justify-content: space-between; padding: 0 24px; background: #fff; }
.appbar .round { width: 64px; height: 64px; border-radius: 50%; background: #f1f2f6; display: grid; place-items: center;
  color: #1167b1; font-size: 34px; }
.appbar h1 { font: 700 23px Inter, Arial; color: #1167b1; }
.tabs { height: 74px; display: grid; grid-template-columns: 226px 198px 1fr; background: #eceef4; border-top: 1px solid #d8dbe4; }
.tabs div { display: grid; place-items: center; font: 700 17px Inter, Arial; color: #666; border-left: 1px solid #d8dbe4; }
.tabs .on { background: #fff; color: #a3166f; border-top: 3px solid #a3166f; border-left: none; }
.monthbar { height: 82px; display: flex; align-items: center; gap: 18px; padding: 0 12px; background: #fff; }
.toggle { display: flex; border: 1px solid #c9cdd8; border-radius: 6px; overflow: hidden; }
.toggle span { width: 62px; height: 60px; display: grid; place-items: center; font-size: 26px; color: #444; }
.toggle .on { background: #1167b1; color: #fff; }
.monthbar .nav { flex: 1; display: flex; justify-content: space-around; align-items: center; font: 17px Inter, Arial; }
.monthbar .nav b { font-size: 30px; font-weight: 400; }
.monthbar .cal { width: 74px; height: 58px; border: 1px solid #c9cdd8; border-radius: 6px; display: grid; place-items: center; font-size: 22px; }
.banner { height: 106px; background: #0b6fb8; color: #fff; display: flex; align-items: center; padding: 0 30px 0 100px; position: relative; }
.banner h3 { font: 700 23px Inter, Arial; margin-bottom: 8px; }
.banner p { font: 16px Inter, Arial; }
.banner .chev { position: absolute; right: 30px; font-size: 34px; }
.banner .ico { position: absolute; left: 34px; font-size: 34px; }
.list { position: absolute; top: 434px; left: 0; right: 0; bottom: 0; overflow: hidden; }
.track { position: absolute; left: 24px; top: 0; width: 2px; height: 4000px; background: #d4d8e2; }
.inner { position: absolute; left: 0; right: 0; }
.day { height: 280px; position: relative; }
.day h2 { position: absolute; top: 34px; left: 48px; right: 24px; font: 700 22px Inter, Arial; color: #444; }
.day .dot { position: absolute; left: -36px; top: 0; width: 26px; height: 26px; border-radius: 50%; background: #fff; border: 2px solid #d4d8e2; }
.day .chev { position: absolute; right: 6px; top: -6px; color: #1167b1; font-size: 34px; font-weight: 400; }
.card { position: absolute; top: 86px; left: 48px; right: 24px; height: 138px; background: #fff; border: 1px solid #d6d9e2;
  border-radius: 4px; display: flex; align-items: center; }
.card .times { width: 104px; display: flex; flex-direction: column; align-items: center; gap: 0; line-height: 31px; font: 700 22px Inter, Arial; color: #444; }
.card .bar { width: 5px; height: 92px; border-radius: 2px; margin-right: 18px; }
.bar.blue { background: #1167b1; } .bar.magenta { background: #a3166f; }
.card .title { font: 700 23px Inter, Arial; color: #444; margin-bottom: 4px; }
.card .place, .card .dur { font: 700 16px Inter, Arial; color: #777; line-height: 23px; }
.card .moon { position: absolute; right: 24px; font-size: 24px; color: #555; }
.card.empty { justify-content: center; gap: 12px; font: 17px Inter, Arial; color: #444; background: #f1f2f6; border-color: #e1e3ea; height: 100px; }
.card.empty .home { font-size: 26px; }
.fab { position: absolute; right: 24px; bottom: 30px; height: 60px; padding: 0 34px; border-radius: 30px; background: #a3166f; color: #fff;
  display: flex; align-items: center; gap: 14px; font: 20px Inter, Arial; box-shadow: 0 4px 10px rgba(0,0,0,.25); }
.fab b { font-size: 30px; font-weight: 400; }
</style></head><body>
<div class="status"><span>09:41</span><span class="icons">▂▄▆ ◔ ▮</span></div>
<div class="appbar"><span class="round">⚙</span><h1>Employee Self Service</h1><span class="round">↻</span></div>
<div class="tabs"><div class="on">TYÖVUOROLISTA</div><div>OMAT TIEDOT</div><div>≡ LISÄÄ</div></div>
<div class="monthbar"><div class="toggle"><span class="on">☰</span><span>▦</span></div>
  <div class="nav"><b>‹</b><span>${SCREENS.monthTitle}</span><b>›</b></div><div class="cal">▣</div></div>
<div class="banner"><span class="ico">🗓</span><div><h3>Haluatko lisää työvuoroja?</h3><p>1 vuoroa vapaana vuoron poimintaan</p></div><span class="chev">›</span></div>
<div class="list"><div class="track"></div><div class="inner" id="inner">${allDays.map(day).join('')}</div></div>
<div class="fab"><b>+</b>Lisää pyyntö</div>
</body></html>`;

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2 });
await page.setContent(html);

for (const [i, frame] of SCREENS.frames.entries()) {
  // второй кадр начинается с хвоста предыдущей карточки, как при прокрутке
  const lead = i === 1 ? 12 : 0;
  await page.evaluate(
    ({ first, lead }) => {
      const inner = document.getElementById('inner');
      const target = document.getElementById(`d${first}`);
      inner.style.top = `${lead - target.offsetTop}px`;
    },
    { first: frame[0], lead },
  );
  const file = new URL(`screen-${i + 1}.jpg`, OUT);
  // снимок в CSS-пикселях: браузер ужимает отрисовку ×2, как телефон или мессенджер
  await page.screenshot({ path: file.pathname, type: 'jpeg', quality: 82, scale: 'css' });
  console.log(`samples/ess/screen-${i + 1}.jpg`);
}
await browser.close();
