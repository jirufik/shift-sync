#!/usr/bin/env node
/**
 * Снимки интерфейса для README — только на синтетических образцах `samples/`.
 *
 * Настоящий график в кадр попасть не должен, поэтому снимать надо с отдельной
 * пустой базы и без подключённого Google:
 *
 *   docker exec fc-postgresql psql -U fc_admin -d postgres -c 'create database fc_shots'
 *   pnpm --filter @fc/contracts build && pnpm --filter @fc/api build && pnpm --filter @fc/web build
 *   cd apps/api && PORT=4085 DB_NAME=fc_shots STORAGE_DIR=/tmp/fc-shots \
 *     GCAL_CALENDAR_ID= GOOGLE_SERVICE_ACCOUNT_JSON=/nonexistent \
 *     APP_PASSWORD=… SESSION_SECRET=… node dist/main.js
 *   BASE=http://localhost:4085 PASSWORD=… node apps/web/scripts/screenshots.mjs
 *
 * Не через `pnpm run dev`: turbo в строгом режиме не пропускает необъявленные
 * переменные, `DB_NAME` теряется, и сервис уходит в рабочую базу. Собранная
 * версия заодно избавляет кадр от панели инструментов Nuxt.
 *
 * Скрипт сам отказывается работать, если в базе уже есть хоть один импорт или
 * смена: всё, что он снимает, он загружает сам, и только из `samples/`.
 */
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4085';
const PASSWORD = process.env.PASSWORD;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = resolve(ROOT, 'docs/screenshots');
const ESS = ['screen-1.jpg', 'screen-2.jpg', 'screen-3.jpg'].map((f) => resolve(ROOT, 'samples/ess', f));
const PDF = ['report-2027-03.pdf', 'report-2027-04.pdf'].map((f) => resolve(ROOT, 'samples/pdf', f));

if (!PASSWORD) {
  console.error('Задайте PASSWORD — пароль входа в сервис (APP_PASSWORD).');
  process.exit(2);
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const problems = [];

async function session(locale, { width = 1280, height = 860, mobile = false } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: mobile ? 3 : 1.5,
    isMobile: mobile,
    hasTouch: mobile,
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`${locale}: ошибка страницы: ${e.message}`));
  await page.goto(`${BASE}/login`);
  await page.evaluate((lang) => {
    localStorage.setItem('fc:locale', lang);
    localStorage.setItem('fc:theme', 'dark');
  }, locale);
  await page.goto(`${BASE}/login`);
  return { context, page };
}

async function login(page) {
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL(`${BASE}/`, { timeout: 15_000 });
}

const api = async (page, path) => {
  const res = await page.request.get(`${BASE}/api${path}`);
  if (!res.ok()) throw new Error(`${path}: ${res.status()}`);
  return res.json();
};

/** Пустая база — единственная, с которой можно снимать. */
async function ensureEmpty(page) {
  const imports = await api(page, '/imports');
  const shifts = await api(page, '/shifts?from=2000-01-01&to=2100-12-31');
  if (imports.length > 0 || shifts.length > 0) {
    throw new Error(
      `в базе ${imports.length} импортов и ${shifts.length} смен — снимать можно только с пустой базы`,
    );
  }
}

async function upload(page, files) {
  const parts = await Promise.all(
    files.map(async (file) => ({
      name: file.split('/').at(-1),
      mimeType: file.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg',
      buffer: await readFile(file),
    })),
  );
  // Playwright принимает один файл на поле, поэтому собираем форму вручную
  const form = new FormData();
  for (const part of parts) form.append('files', new Blob([part.buffer], { type: part.mimeType }), part.name);
  const res = await page.request.post(`${BASE}/api/imports`, { multipart: form });
  if (!res.ok()) throw new Error(`загрузка: ${res.status()} ${await res.text()}`);
  const batch = await res.json();
  for (let i = 0; i < 120; i++) {
    const detail = await api(page, `/imports/${batch.id}`);
    const status = detail.batch?.status ?? detail.status;
    if (status === 'review') return batch.id;
    if (status === 'failed') throw new Error(`импорт ${batch.id} не распознался`);
    await page.waitForTimeout(500);
  }
  throw new Error('распознавание не закончилось за минуту');
}

const settle = (page, ms = 700) => page.waitForTimeout(ms);

async function shoot(page, locale, name, { full = false } = {}) {
  if (locale === 'en') {
    const text = await page.evaluate(() => document.body.innerText);
    const found = text.match(/[А-Яа-яЁё]+/g);
    if (found) problems.push(`en-${name}: кириллица — ${[...new Set(found)].slice(0, 8).join(', ')}`);
  }
  const file = `${OUT}/${locale}-${name}.png`;
  await page.screenshot({ path: file, fullPage: full });
  console.log('снимок:', file);
}

// импорты создаются один раз и снимаются на обоих языках
const setup = await session('en');
await login(setup.page);
await ensureEmpty(setup.page);
const essBatch = await upload(setup.page, ESS);
const pdfBatch = await upload(setup.page, PDF);
await setup.context.close();

for (const locale of ['en', 'ru']) {
  const { context, page } = await session(locale);
  await settle(page);
  await shoot(page, locale, 'login');
  await login(page);

  // загрузка с тремя выбранными кадрами — до нажатия «Распознать»
  await page.setInputFiles('input[type=file]', ESS);
  await page.waitForSelector('.card--drop ~ * img, img', { timeout: 10_000 });
  await settle(page, 900);
  await shoot(page, locale, 'upload');

  await page.goto(`${BASE}/imports/${essBatch}`);
  await page.waitForSelector('.summary', { timeout: 15_000 });
  await settle(page, 900);
  await shoot(page, locale, 'review');

  await page.goto(`${BASE}/imports/${pdfBatch}`);
  await page.waitForSelector('.summary', { timeout: 15_000 });
  await settle(page, 900);
  await shoot(page, locale, 'review-pdf');

  // исходные страницы PDF в блоке «Кадры»
  await page.locator('.shots-block summary').click();
  await page.waitForSelector('.shot img', { timeout: 10_000 });
  await page.locator('.shots-block').scrollIntoViewIfNeeded();
  await settle(page, 900);
  await shoot(page, locale, 'pdf-pages');

  await page.goto(`${BASE}/history`);
  await page.waitForSelector('.card--link', { timeout: 15_000 });
  await settle(page);
  await shoot(page, locale, 'history');
  await context.close();

  // телефон — экран проверки, ради которого сервис и затевался
  const phone = await session(locale, { width: 390, height: 844, mobile: true });
  await login(phone.page);
  await phone.page.goto(`${BASE}/imports/${essBatch}`);
  await phone.page.waitForSelector('.summary', { timeout: 15_000 });
  await settle(phone.page, 900);
  await shoot(phone.page, locale, 'review-phone');
  await phone.context.close();
}

await browser.close();

if (problems.length) {
  console.error('Найдено:');
  for (const problem of problems) console.error(' -', problem);
  process.exit(1);
}
