/**
 * Прогон интерфейса в браузере: обход всех экранов на обоих языках.
 *
 * Проверяет то, чего не видят юнит-тесты: что разметка не разъехалась, что в
 * консоли нет ошибок и что на английском экране не осталось русских строк
 * (D-024). Забытый перевод не даёт никакой ошибки — интерфейс просто
 * показывает русскую фразу на английской странице, и найти это можно только
 * обойдя всё после каждой правки.
 *
 * Требует запущенного сервиса. Импорт для экрана ревью необязателен: без него
 * проверяются загрузка, история и вход.
 *
 *   BASE=http://localhost:4080 PASSWORD=… [BATCH=<uuid>] \
 *     node apps/web/scripts/check-ui.mjs
 *
 * Снимки экрана кладутся в SHOTS, если он задан.
 * Первый раз: pnpm exec playwright install chromium
 */
import { mkdir } from 'node:fs/promises';

import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4081';
const PASSWORD = process.env.PASSWORD;
const BATCH = process.env.BATCH;
const SHOTS = process.env.SHOTS;

if (!PASSWORD) {
  console.error('Задайте PASSWORD — пароль входа в сервис (APP_PASSWORD из .env).');
  process.exit(2);
}

const problems = [];
const browser = await chromium.launch();

if (SHOTS) await mkdir(SHOTS, { recursive: true });

/** Экраны, которые есть всегда, плюс ревью, если передали импорт. */
const SCREENS = ['/', '/history', ...(BATCH ? [`/imports/${BATCH}`] : [])];

for (const locale of ['ru', 'en']) {
  for (const theme of ['light', 'dark']) {
    const tag = `${locale}/${theme}`;
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('console', (m) => m.type() === 'error' && problems.push(`${tag} консоль: ${m.text()}`));
    page.on('pageerror', (e) => problems.push(`${tag} ошибка страницы: ${e.message}`));

    // выбор языка и темы живёт в localStorage, поэтому сначала открываем
    // страницу, а уже потом перезагружаем её с нужными значениями
    await page.goto(`${BASE}/login`);
    await page.evaluate(([l, t]) => {
      localStorage.setItem('fc:locale', l);
      localStorage.setItem('fc:theme', t);
    }, [locale, theme]);
    await page.goto(`${BASE}/login`);

    await page.fill('input[type=password]', PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL(`${BASE}/`, { timeout: 15_000 });

    for (const path of SCREENS) {
      await page.goto(`${BASE}${path}`);
      await page.waitForSelector('h1', { timeout: 15_000 });
      // экран ревью опрашивает статус и дорисовывается после ответа
      await page.waitForTimeout(600);

      if (SHOTS) {
        const name = path.replace(/\W+/g, '-').replace(/^-|-$/g, '') || 'index';
        await page.screenshot({ path: `${SHOTS}/${name}-${locale}-${theme}.png`, fullPage: true });
      }

      if (locale === 'en') {
        const text = await page.evaluate(() => document.body.innerText);
        const found = text.match(/[А-Яа-яЁё]+/g);
        if (found) {
          problems.push(`англ. ${path}: кириллица — ${[...new Set(found)].slice(0, 8).join(', ')}`);
        }
      }
    }

    // подтверждение отмены: заголовок, пояснение и две кнопки
    if (BATCH) {
      await page.goto(`${BASE}/imports/${BATCH}`);
      await page.waitForSelector('h1', { timeout: 15_000 });
      const danger = page.locator('.btn--danger').first();
      if (await danger.count()) {
        await danger.click();
        await page.waitForSelector('.modal', { timeout: 5_000 });
        if (locale === 'en') {
          const modalText = await page.locator('.modal').innerText();
          const found = modalText.match(/[А-Яа-яЁё]+/g);
          if (found) problems.push(`англ. подтверждение: кириллица — ${[...new Set(found)].join(', ')}`);
        }
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/confirm-${locale}-${theme}.png` });
        await page.locator('.modal .btn:not(.btn--danger)').click();
        await page.waitForTimeout(200);
        if (await page.locator('.modal').count()) {
          problems.push(`${tag}: подтверждение не закрылось по «оставить»`);
        }
      }
    }

    // меню настроек: язык, тема, четыре гаммы и выход
    await page.click('.gear');
    await page.waitForSelector('.menu', { timeout: 5_000 });
    const rows = await page.locator('.menu .row-item, .menu .menu__item').count();
    if (rows !== 7) problems.push(`${tag}: в меню настроек ${rows} строк вместо семи`);

    // подписи в меню тоже переводятся — их не видно в document.body до открытия
    if (locale === 'en') {
      const menuText = await page.locator('.menu').innerText();
      const found = menuText.match(/[А-Яа-яЁё]+/g);
      if (found) problems.push(`англ. меню: кириллица — ${[...new Set(found)].join(', ')}`);
    }

    await page.close();
  }
}

await browser.close();

if (problems.length) {
  console.error('Найдено:');
  for (const problem of problems) console.error(' -', problem);
  process.exit(1);
}
console.log('Интерфейс чист: ни ошибок в консоли, ни кириллицы на английском.');
