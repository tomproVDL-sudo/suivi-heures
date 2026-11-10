// Utilitaires partagés : dates locales, formatage, DOM, chargement paresseux.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const pad = (n) => String(n).padStart(2, '0');
export const HOUR = 3600000;
export const MIN = 60000;
export const DAY = 86400000;

/** Clé de jour LOCALE "AAAA-MM-JJ" (évite les décalages UTC de toISOString). */
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
/** "AAAA-MM-JJ" -> Date à minuit local. */
export const parseDay = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
export const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
export const todayKey = () => dayKey(new Date());
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const startOfWeek = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); return x; };
export const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
export const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
export const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
export const minutesOfDay = (t) => { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); };
export const hoursOfDay = (t) => { const d = new Date(t); return d.getHours() + d.getMinutes() / 60; };

/** Itère chaque jour (Date à minuit local) de start à end inclus. */
export function* eachDay(start, end) {
  const d = new Date(start); d.setHours(0, 0, 0, 0);
  const e = new Date(end); e.setHours(0, 0, 0, 0);
  while (d <= e) { yield new Date(d); d.setDate(d.getDate() + 1); }
}

/** Semaine ISO : { year, week }. */
export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { year: d.getUTCFullYear(), week: Math.ceil(((d - yearStart) / DAY + 1) / 7) };
}
export const weekKey = (d) => { const w = isoWeek(d); return `${w.year}-S${pad(w.week)}`; };

// ---------- Formatage ----------
/** Durée en ms -> "7h48" ; options : sign (force +), zero ("0h00"). */
export function fmtDur(ms, { sign = false } = {}) {
  if (ms == null || Number.isNaN(ms)) return '--';
  const neg = ms < 0;
  const tot = Math.round(Math.abs(ms) / MIN);
  const h = Math.floor(tot / 60), m = tot % 60;
  return `${neg ? '-' : sign ? '+' : ''}${h}h${pad(m)}`;
}
/** Heures décimales -> "8h30". */
export function fmtHM(dec) {
  if (dec == null || Number.isNaN(dec)) return '--';
  let tot = Math.round(dec * 60);
  const neg = tot < 0; tot = Math.abs(tot);
  return `${neg ? '-' : ''}${Math.floor(tot / 60)}h${pad(tot % 60)}`;
}
export const fmtTime = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const fmtDate = (d, opts = { day: '2-digit', month: '2-digit', year: 'numeric' }) => new Date(d).toLocaleDateString('fr-FR', opts);
export const fmtDays = (n) => { const v = Math.round(n * 100) / 100; return `${String(v).replace('.', ',')} j`; };
export const fmtNum = (n, dec = 1) => (Math.round(n * 10 ** dec) / 10 ** dec).toLocaleString('fr-FR');
export const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Équivalence lisible d'un écart en heures ("~ 1,2 sem."). */
export function equivalence(hours, hoursPerDay) {
  const j = Math.abs(hours) / (hoursPerDay || 7.8);
  const s = j / 5, mo = s / (52 / 12);
  if (mo >= 1) return `≈ ${fmtNum(mo)} mois (${Math.round(j)} j)`;
  if (s >= 1) return `≈ ${fmtNum(s)} sem.`;
  if (j >= 1) return `≈ ${fmtNum(j)} j`;
  return '';
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Divers ----------
export function debounce(fn, ms = 150) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

const scriptCache = new Map();
/** Charge un script UMD à la demande (une seule fois). */
export function loadScript(src) {
  if (!scriptCache.has(src)) {
    scriptCache.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true; s.crossOrigin = 'anonymous';
      s.onload = resolve;
      s.onerror = () => { scriptCache.delete(src); reject(new Error(`Impossible de charger ${src.split('/').pop()} (connexion ?)`)); };
      document.head.appendChild(s);
    }));
  }
  return scriptCache.get(src);
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Numéro de série Excel (jour) pour une date locale. */
export const excelDate = (d) => (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / DAY;

/** Lit une date Excel (nombre de série ou texte JJ/MM/AAAA, AAAA-MM-JJ) -> "AAAA-MM-JJ". */
export function readExcelDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    const d = new Date(Math.round((Math.floor(v) - 25569) * DAY));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  if (v instanceof Date) return dayKey(v);
  const s = String(v).trim();
  const p = s.split(/[/.-]/);
  if (p.length !== 3) return null;
  let y, m, d;
  if (p[0].length === 4) [y, m, d] = p; else [d, m, y] = p;
  if (y.length === 2) y = `20${y}`;
  const out = `${y}-${pad(+m)}-${pad(+d)}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(out) && !Number.isNaN(parseDay(out).getTime()) ? out : null;
}
/** Lit une heure Excel (fraction ou "HH:MM") -> "HH:MM". */
export function readExcelTime(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    const frac = v - Math.floor(v);
    const tot = Math.round(frac * 1440) % 1440;
    return `${pad(Math.floor(tot / 60))}:${pad(tot % 60)}`;
  }
  const m = String(v).trim().match(/^(\d{1,2})[:hH](\d{2})/);
  return m ? `${pad(+m[1])}:${pad(+m[2])}` : null;
}
