import { describe, expect, it } from 'vitest';

import { FALLBACK_DATES, GROUND_TRUTH, recognizeFixture } from '../../../test/fixtures/ground-truth';
import { loadOcrFixture } from '../../../test/fixtures/load-fixture';
import {
  parseDayHeader,
  parseMonthHeader,
  parseTitleRange,
  parseVuoroaika,
} from './parsers/ortec-ess.parser';
import { isNoShiftPhrase, matchVocab, MONTHS, WEEKDAYS } from './vocabulary/finnish';

describe('закрытый финский словарь', () => {
  it('вытягивает опечатки OCR в названиях месяцев', () => {
    for (const typo of ['syyskuuta', 'syyskuute', 'syvskuuta', 'syyskuufa']) {
      expect(matchVocab(typo, MONTHS)?.index).toBe(8);
    }
  });

  it('не притягивает за уши посторонние слова', () => {
    expect(matchVocab('Market', MONTHS)).toBeNull();
    expect(matchVocab('Vuoroaika', WEEKDAYS)).toBeNull();
  });

  it('узнаёт фразу «смены нет» несмотря на потерянную диакритику', () => {
    expect(isNoShiftPhrase('Sinulla ei ole työvuoroa tänä päivänä')).toBe(true);
    expect(isNoShiftPhrase('Sinulla ei ole tyovuoroa tana paivana')).toBe(true);
    expect(isNoShiftPhrase('Vuoroaika: 6 h, Työaika: 6 h')).toBe(false);
  });
});

describe('разбор строк ORTEC', () => {
  it('читает шапку месяца с годом', () => {
    expect(parseMonthHeader('syyskuuta 2026')).toEqual({ monthIndex: 8, year: 2026 });
  });

  it('читает заголовок дня', () => {
    const h = parseDayHeader('sunnuntai, syyskuuta 13');
    expect(h).toMatchObject({ weekdayIndex: 6, monthIndex: 8, day: 13 });
  });

  it('вытаскивает диапазон из заголовка карточки, включая слипшийся код смены', () => {
    expect(parseTitleRange('410 8-14')).toEqual({ startMin: 480, endMin: 840 });
    expect(parseTitleRange('410 8.30-15.30')).toEqual({ startMin: 510, endMin: 930 });
    // OCR регулярно слипает код с временем
    expect(parseTitleRange('4109-15.30')).toEqual({ startMin: 540, endMin: 930 });
    expect(parseTitleRange('410 Tupakka/kassa')).toBeNull();
  });

  it('не приплюсовывает минуты из Työaika к Vuoroaika', () => {
    // ловушка: наивный разбор даёт 8 ч 30 мин вместо 8 ч
    expect(parseVuoroaika('Vuoroaika: 8 h, Työaika: 7 h ja 30 min')).toBe(480);
    expect(parseVuoroaika('Vuoroaika: 6 h ja 30 min, Työaika: 6 h ja 30 min')).toBe(390);
    expect(parseVuoroaika('Vuoroaika: 7 h, Työaika: 7 h')).toBe(420);
  });
});

describe('сквозной разбор снимков экрана', () => {
  const byDate = recognizeFixture(loadOcrFixture());

  it('находит все девять дней из эталона', () => {
    expect([...byDate.keys()].sort()).toEqual(Object.keys(GROUND_TRUTH).sort());
  });

  for (const [date, expected] of Object.entries(GROUND_TRUTH)) {
    it(`${date} — ${expected.kind}`, () => {
      const row = byDate.get(date);
      expect(row, `нет строки на ${date}`).toBeDefined();
      expect(row!.kind).toBe(expected.kind);

      if (expected.kind === 'shift') {
        expect(row!.startsAt).toBe(expected.startsAt);
        expect(row!.endsAt).toBe(expected.endsAt);
        expect(row!.ok, `шлюз не пропустил: ${row!.reason}`).toBe(true);
      }
      if (expected.kind === 'non_work_marker') {
        // TES V должен быть отбракован проверкой длительности
        expect(row!.ok).toBe(false);
        expect(row!.checks.sane).toBe(false);
      }
    });
  }

  it('проверка дня недели проходит для всех распознанных дат', () => {
    for (const row of byDate.values()) {
      expect(row.checks.weekday, `${row.workDate}: ${row.reason}`).toBe(true);
    }
  });

  it('где OCR потерял время в колонке, оно восстановлено из заголовка карточки', () => {
    // на этих кадрах OCR не прочитал одно из двух значений левой колонки —
    // ровно тот случай, ради которого время читается из трёх источников
    const fallback = [...byDate.values()].filter((r) => r.usedFallback).map((r) => r.workDate);
    expect(fallback.sort()).toEqual(FALLBACK_DATES);
  });
});
