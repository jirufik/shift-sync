import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import type { OcrPage } from '../../src/modules/recognition/types';

interface RawItem {
  t: string;
  x: number;
  y: number;
  w: number;
  h: number;
  c: number;
  s: boolean;
}

type RawDump = Record<string, { ms: number; items: RawItem[] }>;

/**
 * Сохранённая выдача PP-OCRv5 по кадрам. Тесты гоняют парсер и шлюз
 * на ней, а не на модели: это делает их быстрыми, детерминированными и
 * независимыми от наличия скачанных весов.
 */
export function loadOcrFixture(name = 'ess-synthetic.json'): OcrPage[] {
  const path = isAbsolute(name) ? name : join(__dirname, name);
  const raw = JSON.parse(readFileSync(path, 'utf8')) as RawDump;
  return Object.values(raw).map((page) => ({
    items: page.items.map((i) => ({
      text: i.t,
      box: { x: i.x, y: i.y, width: i.w, height: i.h },
      confidence: i.c,
      salvaged: i.s,
    })),
    width: 590,
    height: 1280,
    salvagedCount: page.items.filter((i) => i.s).length,
    durationMs: page.ms,
  }));
}
