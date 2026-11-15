import { PaddleOcrService, V5_LATIN_MOBILE_MODEL } from 'ppu-paddle-ocr';

/** текстоподобный бокс: вытянутый по горизонтали и достаточно высокий */
const isTextLike = b => b.width / b.height >= 3 && b.height >= 14;

export async function createService() {
  const svc = new PaddleOcrService({
    model: V5_LATIN_MOBILE_MODEL,
    detection: { maxSideLength: 1280 },
  });
  await svc.initialize();
  return svc;
}

/**
 * Распознавание с добором: боксы, которые детекция нашла, а батч-проход
 * потерял, до-распознаются поодиночке. Стоит один лишний инференс на кроп.
 */
export async function recognizeWithSalvage(svc, ab) {
  const t0 = Date.now();
  const [det, rec] = await Promise.all([
    svc.detect(ab, { crop: true }),
    svc.recognize(ab, { flatten: true }),
  ]);
  const got = rec.results.filter(r => r.text.trim().length > 0);
  const covered = b => got.some(r => Math.abs(r.box.y - b.y) < 12 && Math.abs(r.box.x - b.x) < 20);

  const salvaged = [];
  if (det.crops) {
    for (let i = 0; i < det.boxes.length; i++) {
      const b = det.boxes[i];
      if (covered(b) || !isTextLike(b)) continue;
      const crop = det.crops[i];
      if (!crop) continue;
      const r = await svc.recognize(crop, { flatten: true });
      for (const item of r.results) {
        if (!item.text.trim()) continue;
        salvaged.push({ text: item.text, box: b, confidence: item.confidence, salvaged: true });
      }
    }
  }
  const all = [...got, ...salvaged].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  return { items: all, salvagedCount: salvaged.length, ms: Date.now() - t0 };
}
