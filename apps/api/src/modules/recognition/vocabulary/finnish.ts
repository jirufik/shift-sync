/**
 * Закрытый словарь. Весь «сложный» текст, который нужно прочитать в ORTEC ESS, —
 * это числа и девятнадцать финских слов. Нечёткое сопоставление с этим списком
 * вытягивает даже неидеальный OCR: `syyskuute`, `syvskuuta`, `syyskuufa`
 * однозначно схлопываются в `syyskuuta`.
 */

/** Понедельник = 0, как в ISO. */
export const WEEKDAYS = [
  'maanantai',
  'tiistai',
  'keskiviikko',
  'torstai',
  'perjantai',
  'lauantai',
  'sunnuntai',
] as const;

/** Партитив, в котором ORTEC печатает месяц: «syyskuuta 13». Январь = 0. */
export const MONTHS = [
  'tammikuuta',
  'helmikuuta',
  'maaliskuuta',
  'huhtikuuta',
  'toukokuuta',
  'kesäkuuta',
  'heinäkuuta',
  'elokuuta',
  'syyskuuta',
  'lokakuuta',
  'marraskuuta',
  'joulukuuta',
] as const;

/** «В этот день у тебя нет смены» — явное утверждение, а не пустота. */
export const NO_SHIFT_PHRASE = 'Sinulla ei ole työvuoroa tänä päivänä';

/**
 * Приводит слово к сравнимому виду: диакритика разворачивается в базовые буквы,
 * всё лишнее отбрасывается. `Työvuoroa` и `Tyovuoroa` становятся одинаковыми,
 * что важно, потому что OCR путает ä/ö в подписях.
 */
export function fold(input: string): string {
  return input
    .toLowerCase()
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/å/g, 'a')
    .replace(/[^a-z0-9]/g, '');
}

/** Расстояние Левенштейна на двух строках. */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let cur = new Array<number>(n + 1);

  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

export interface VocabMatch {
  index: number;
  distance: number;
}

/** Ближайшее слово из закрытого списка, если оно достаточно близко. */
export function matchVocab(
  word: string,
  list: readonly string[],
  maxDistance = 2,
): VocabMatch | null {
  const w = fold(word);
  if (!w) return null;

  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < list.length; i++) {
    const d = levenshtein(w, fold(list[i]));
    if (d < bestDistance) {
      bestDistance = d;
      bestIndex = i;
    }
  }
  return bestDistance <= maxDistance ? { index: bestIndex, distance: bestDistance } : null;
}

const NO_SHIFT_FOLDED = fold(NO_SHIFT_PHRASE);

/**
 * Фраза длинная, поэтому допуск больше: на 31 символ шесть ошибок — это
 * примерно 80% совпадения, чего достаточно, а случайно совпасть с чем-то
 * другим на экране такая строка не может.
 */
export function isNoShiftPhrase(text: string, maxDistance = 6): boolean {
  return levenshtein(fold(text), NO_SHIFT_FOLDED) <= maxDistance;
}
