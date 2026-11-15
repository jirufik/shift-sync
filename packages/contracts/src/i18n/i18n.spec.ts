import { describe, expect, it } from 'vitest';

import { message } from '../common.js';
import { EN } from './en.js';
import { RU } from './ru.js';
import { translate, translateMessage } from './index.js';

/**
 * Забытый перевод не даёт никакой ошибки: интерфейс просто показывает русскую
 * строку на английском экране. Найти это глазами можно только обойдя все
 * разделы после каждой правки, и рано или поздно этого не сделают — см. D-024.
 */
describe('словари', () => {
  it('в обоих языках один и тот же набор ключей', () => {
    const onlyRu = Object.keys(RU).filter((key) => !(key in EN));
    const onlyEn = Object.keys(EN).filter((key) => !(key in RU));

    expect({ onlyRu, onlyEn }).toEqual({ onlyRu: [], onlyEn: [] });
  });

  it('подстановки совпадают в обеих версиях', () => {
    const holes = (text: string): string[] =>
      [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

    const mismatched = Object.keys(RU).filter(
      (key) => holes(RU[key]).join() !== holes(EN[key]).join(),
    );
    expect(mismatched).toEqual([]);
  });

  it('ни одна строка не осталась непереведённой', () => {
    // одинаковый текст допустим только там, где переводить нечего:
    // имена собственные и знаки препинания
    const SAME_ON_PURPOSE = new Set(['app.name', 'palette.catppuccin']);

    const copied = Object.keys(RU).filter(
      (key) => RU[key] === EN[key] && !SAME_ON_PURPOSE.has(key) && !/^[\d\s—·-]*$/.test(RU[key]),
    );
    expect(copied).toEqual([]);
  });

  it('в английской версии не осталось кириллицы', () => {
    const cyrillic = Object.keys(EN).filter((key) => /[А-Яа-яЁё]/.test(EN[key]));
    expect(cyrillic).toEqual([]);
  });
});

describe('перевод', () => {
  it('подставляет значения', () => {
    expect(translate('ru', 'upload.picked', { count: 3 })).toBe('Выбрано файлов: 3');
    expect(translate('en', 'upload.picked', { count: 3 })).toBe('Files chosen: 3');
  });

  it('неизвестный ключ возвращается как есть, а не пустой строкой', () => {
    expect(translate('en', 'нет.такого')).toBe('нет.такого');
  });

  it('незаполненная подстановка остаётся в фигурных скобках', () => {
    expect(translate('ru', 'history.frames', {})).toBe('кадров: {count}');
  });

  it('собирает сообщение сервера по коду', () => {
    const entry = message('msg.duration-mismatch', { duration: 355, expected: 360 });
    expect(translateMessage('ru', entry)).toContain('355');
    expect(translateMessage('en', entry)).toContain('Vuoroaika 360');
  });

  it('причина, сохранённая до перехода на коды, отдаётся как есть', () => {
    // в строках, распознанных старой версией, лежит готовая русская фраза;
    // показать её честнее, чем `msg.undefined` на месте причины
    expect(translateMessage('en', 'Карточка обрезана')).toBe('Карточка обрезана');
    expect(translateMessage('ru', null)).toBe('');
  });
});
