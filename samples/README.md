# Samples

Synthetic inputs for tests, the OCR bench and the README screenshots.
**Everything here is made up** — the person, the store and every shift come from
[`tools/samples/schedule.mjs`](../tools/samples/schedule.mjs).

| Folder | What | Generator |
|---|---|---|
| `ess/` | three phone screenshots of the ESS «Työvuorolista» tab, 590×1280 | `tools/samples/make-screens.mjs` (Playwright) |
| `pdf/` | two «Henkilön työvuorolista» PDF reports with the real report's geometry | `tools/samples/make-pdf.mjs` (mupdf) |

Regenerate: `pnpm samples` (first time: `pnpm --filter @fc/samples exec playwright install chromium`).
After regenerating the screenshots, rerun the OCR bench and copy its output to the API fixture:

```bash
cd tools/ocr-bench && node run.mjs && node score.mjs
cp raw-v5-salvage.json ../../apps/api/test/fixtures/ess-synthetic.json
```
