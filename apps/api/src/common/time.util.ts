/** Минуты от полуночи → `HH:MM`. */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** `HH:MM` → минуты от полуночи. */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Год, месяц (0-based), день → `YYYY-MM-DD`. Без часовых поясов. */
export function toIsoDate(year: number, monthIndex: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** День недели для даты: понедельник = 0. Считается в UTC, чтобы не зависеть от зоны процесса. */
export function isoWeekday(year: number, monthIndex: number, day: number): number {
  return (new Date(Date.UTC(year, monthIndex, day)).getUTCDay() + 6) % 7;
}

/** Существует ли такая календарная дата (отсекает 31 февраля). */
export function isRealDate(year: number, monthIndex: number, day: number): boolean {
  const d = new Date(Date.UTC(year, monthIndex, day));
  return (
    d.getUTCFullYear() === year && d.getUTCMonth() === monthIndex && d.getUTCDate() === day
  );
}
