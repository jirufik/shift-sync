export interface OcrBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrItem {
  text: string;
  box: OcrBox;
  confidence: number;
  /** бокс подобран доборным проходом, а не основным батчем */
  salvaged: boolean;
}

export interface OcrPage {
  items: OcrItem[];
  width: number;
  height: number;
  /** сколько боксов подобрал добор */
  salvagedCount: number;
  durationMs: number;
}

/**
 * Строка текста из PDF со своим прямоугольником в координатах страницы
 * (пункты, начало отсчёта — левый верхний угол).
 *
 * Скриншот приходится читать моделью, PDF — нет: выгрузка ORTEC несёт
 * настоящий текстовый слой, и координаты в нём точные. Поэтому у строки нет
 * поля `confidence` — сомневаться не в чем.
 */
export interface PdfLine {
  text: string;
  /** левый край; по нему строка относится к колонке таблицы */
  x: number;
  /** правый край */
  right: number;
  y: number;
  height: number;
}

export interface PdfPageText {
  index: number;
  width: number;
  height: number;
  lines: PdfLine[];
}
