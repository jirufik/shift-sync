// ── закрытый финский словарь ────────────────────────────────────────────────
export const WEEKDAYS = ['maanantai','tiistai','keskiviikko','torstai','perjantai','lauantai','sunnuntai'];
export const MONTHS = ['tammikuuta','helmikuuta','maaliskuuta','huhtikuuta','toukokuuta','kesakuuta',
                       'heinakuuta','elokuuta','syyskuuta','lokakuuta','marraskuuta','joulukuuta'];

const fold = s => s.toLowerCase().replace(/ä/g,'a').replace(/ö/g,'o').replace(/[^a-z0-9]/g,'');

function lev(a,b){
  const m=a.length,n=b.length; if(!m) return n; if(!n) return m;
  let prev=Array.from({length:n+1},(_,j)=>j), cur=new Array(n+1);
  for(let i=1;i<=m;i++){ cur[0]=i;
    for(let j=1;j<=n;j++) cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));
    [prev,cur]=[cur,prev];
  }
  return prev[n];
}
/** нечёткое сопоставление с закрытым словарём */
export function matchVocab(word, list, maxDist=2){
  const w = fold(word); if(!w) return null;
  let best=null, bd=Infinity;
  for(let i=0;i<list.length;i++){ const d=lev(w, fold(list[i])); if(d<bd){bd=d;best=i;} }
  return bd<=maxDist ? {index:best, dist:bd} : null;
}

// ── разбор строк ────────────────────────────────────────────────────────────
const reTime = /^(\d{1,2})[:.](\d{2})$/;
const toMin = (h,m) => h*60+m;

/** «sunnuntai, syyskuuta 13» → {weekdayIdx, monthIdx, day} */
export function parseDayHeader(text){
  const parts = text.split(/[,\s]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const wd = matchVocab(parts[0], WEEKDAYS);
  const mo = matchVocab(parts[1], MONTHS);
  const day = Number.parseInt(parts[2], 10);
  if (!wd || !mo || !Number.isInteger(day) || day<1 || day>31) return null;
  return { weekdayIdx: wd.index, monthIdx: mo.index, day, dist: wd.dist+mo.dist };
}

/** «syyskuuta 2026» → {monthIdx, year} */
export function parseMonthHeader(text){
  const m = text.match(/([A-Za-zÄÖäö]+kuuta)\s+(\d{4})/);
  if(!m) return null;
  const mo = matchVocab(m[1], MONTHS);
  return mo ? { monthIdx: mo.index, year: Number(m[2]) } : null;
}

/** «410 8.30-15.30» / «4109-16» / «410 Tupakka/kassa» → диапазон или null */
export function parseTitleRange(text){
  const m = text.match(/(\d{1,2})(?:[.:](\d{2}))?\s*[-–—]\s*(\d{1,2})(?:[.:](\d{2}))?\s*$/);
  if(!m) return null;
  const s = toMin(+m[1], m[2]?+m[2]:0), e = toMin(+m[3], m[4]?+m[4]:0);
  if(s>=e || e>24*60) return null;
  return { startMin:s, endMin:e };
}

/** «Vuoroaika: 6 h ja 30 min» → минуты */
export function parseVuoroaika(text){
  if(!/vuoroaika/i.test(text)) return null;
  // важно: обрезать по Työaika/запятой, иначе «ja 30 min» из Työaika приплюсуется
  let seg = text.split(/vuoroaika\s*:?/i)[1] ?? '';
  seg = seg.split(/[,;]|ty[oö]aika/i)[0];
  const h = seg.match(/(\d+)\s*h/i), mm = seg.match(/(\d+)\s*min/i);
  if(!h && !mm) return null;
  return (h?+h[1]*60:0) + (mm?+mm[1]:0);
}

const NO_SHIFT = 'sinullaeioletyovuoroatanapaivana';
export const isNoShift = t => lev(fold(t), NO_SHIFT) <= 6;

// ── парсер вёрстки ORTEC ESS ────────────────────────────────────────────────
export function parseScreenshot(items, imageHeight, opts={}){
  const leftColMaxX = opts.leftColMaxX ?? 140;
  const clipMargin  = opts.clipMargin  ?? 24;

  let month = null;
  for(const it of items){ const m = parseMonthHeader(it.t); if(m){ month = m; break; } }

  // заголовки дней
  const headers = [];
  for(const it of items){
    const h = parseDayHeader(it.t);
    if(h) headers.push({ ...h, y: it.y, h: it.h });
  }
  headers.sort((a,b)=>a.y-b.y);

  const rows = [];
  for(let i=0;i<headers.length;i++){
    const hd = headers[i];
    const yFrom = hd.y + hd.h;
    const yTo = i+1 < headers.length ? headers[i+1].y : imageHeight;
    const band = items.filter(it => it.y >= yFrom - 4 && it.y < yTo - 4);

    const times = band.filter(it => it.x <= leftColMaxX && reTime.test(it.t.trim()))
                      .map(it => { const m=it.t.trim().match(reTime); return { min: toMin(+m[1],+m[2]), y: it.y }; })
                      .sort((a,b)=>a.y-b.y);

    let titleRange = null, vuoro = null, noShift = false, label = null;
    for(const it of band){
      if(!titleRange){ const r = parseTitleRange(it.t); if(r && it.x > leftColMaxX){ titleRange = r; label = it.t.trim(); } }
      if(vuoro===null){ const v = parseVuoroaika(it.t); if(v!==null) vuoro = v; }
      if(isNoShift(it.t)) noShift = true;
    }

    // обрезана ли карточка кромкой изображения
    const clipped = yTo >= imageHeight - clipMargin && band.length>0 && times.length<2 && !noShift && !titleRange;

    rows.push({
      header: hd, month, band, times, titleRange, vuoro, noShift, label,
      clipped, yFrom, yTo,
    });
  }
  return { month, headers, rows };
}

// ── шлюз валидации ──────────────────────────────────────────────────────────
const FI_WD = ['maanantai','tiistai','keskiviikko','torstai','perjantai','lauantai','sunnuntai'];

export function validateRow(row, yearHint){
  const checks = {};
  const month = row.month ?? { monthIdx: row.header.monthIdx, year: yearHint };
  const year = month.year ?? yearHint;
  const date = new Date(Date.UTC(year, row.header.monthIdx, row.header.day));
  const iso = date.toISOString().slice(0,10);

  // 1 · день недели ↔ дата
  const realWd = (date.getUTCDay()+6)%7;               // 0=maanantai
  checks.weekday = realWd === row.header.weekdayIdx;

  if (row.noShift) {
    return { kind:'no_shift', date:iso, checks, ok: checks.weekday };
  }

  // источники времени
  const fromCol = row.times.length>=2 ? { startMin: row.times[0].min, endMin: row.times[row.times.length-1].min } : null;
  const fromTitle = row.titleRange;

  // 2 · колонка ↔ заголовок карточки
  checks.timesAgree = (fromCol && fromTitle)
    ? (fromCol.startMin===fromTitle.startMin && fromCol.endMin===fromTitle.endMin)
    : null;

  const src = fromCol ?? fromTitle;
  if(!src) return { kind:'unparsed', date:iso, checks, ok:false, reason:'нет ни колонки, ни диапазона в заголовке' };

  // 3 · длительность ↔ Vuoroaika
  const dur = src.endMin - src.startMin;
  checks.duration = row.vuoro===null ? null : (dur === row.vuoro);

  // 4 · длительность в разумных пределах  → отсекает TES V
  checks.sane = dur >= 15 && dur <= 16*60;

  // 5 · карточка не обрезана
  checks.notClipped = !row.clipped;

  const hard = [checks.weekday, checks.sane, checks.notClipped];
  const soft = [checks.timesAgree, checks.duration].filter(v=>v!==null);
  const ok = hard.every(Boolean) && soft.every(Boolean);
  const sources = (fromCol?1:0) + (fromTitle?1:0) + (row.vuoro!==null?1:0);

  return {
    kind: checks.sane ? 'shift' : 'non_work_marker',
    date: iso,
    startMin: src.startMin, endMin: src.endMin,
    label: row.label, sources, checks, ok,
    usedFallback: !fromCol,
  };
}

export const fmt = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
