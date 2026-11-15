/**
 * Прогон OCR по всем кадрам каталога и сохранение сырой выдачи.
 *
 *   node run.mjs [каталог] [файл-выдачи]
 *
 * По умолчанию — синтетические кадры из `samples/ess/` и `raw-v5-salvage.json`.
 * Свои снимки можно прогнать так же, указав их каталог и другой файл выдачи.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService, recognizeWithSalvage } from './recognize.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DIR = resolve(process.argv[2] ?? resolve(HERE, '../../samples/ess')) + '/';
const OUT = resolve(process.argv[3] ?? resolve(HERE, 'raw-v5-salvage.json'));
const files = (await readdir(DIR)).filter(f => /\.(jpe?g|png)$/i.test(f)).sort();

const svc = await createService();
const dump = {};
for (const f of files) {
  const b = await readFile(DIR + f);
  const { items, salvagedCount, ms } = await recognizeWithSalvage(svc, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  dump[f] = { ms, items: items.map(r => ({
    t: r.text, x: Math.round(r.box.x), y: Math.round(r.box.y),
    w: Math.round(r.box.width), h: Math.round(r.box.height),
    c: +r.confidence.toFixed(3), s: !!r.salvaged,
  })) };
  console.log(`${f}: ${ms} ms, ${items.length} боксов, добрано ${salvagedCount}`);
}
await writeFile(OUT, JSON.stringify(dump, null, 2));
await svc.destroy();
