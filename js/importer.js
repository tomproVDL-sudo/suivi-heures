// Import Excel/CSV de pointages ou d'absences (avec dédoublonnage).
import { CDN } from './config.js';
import { loadScript, readExcelDate, readExcelTime } from './util.js';
import { ABSENCE_TYPES } from './calc.js';
import * as store from './store.js';

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function pickCol(row, names) {
  for (const k of Object.keys(row)) if (names.includes(norm(k))) return row[k];
  return undefined;
}
function normAction(v) {
  const s = norm(v);
  if (s.includes('arriv') || s.includes('reprise') || s === 'entree') return 'arrivee';
  if (s.includes('pause')) return 'pause';
  if (s.includes('dep') || s.includes('sortie') || s.includes('fin')) return 'depart';
  return null;
}
function normType(v) {
  const s = norm(v);
  if (!s) return null;
  if (s === 'cp' || s.includes('conge') || s === 'ca') return 'CP';
  if (s.includes('rtt')) return 'RTT';
  if (s.includes('cet')) return 'CET';
  if (s.includes('aea') || s.includes('exception')) return 'AEA';
  if (s.includes('format')) return 'Formation';
  if (s.includes('malad') || s.includes('arret')) return 'Maladie';
  const exact = Object.keys(ABSENCE_TYPES).find((t) => norm(t) === s);
  return exact || String(v).trim();
}
function normMoment(v) {
  const s = norm(v);
  if (s.startsWith('mat') || s === 'am') return 'matin';
  if (s.includes('apr') || s === 'pm') return 'aprem';
  return 'journee';
}

export async function parseImport(file, kind) {
  await loadScript(CDN.xlsx);
  const X = window.XLSX;
  const wb = X.read(await file.arrayBuffer(), { type: 'array' });
  const name = wb.SheetNames.find((n) => (kind === 'pointages' ? /point/i : /abs/i).test(n)) || wb.SheetNames[0];
  const json = X.utils.sheet_to_json(wb.Sheets[name], { defval: '' });
  const rows = []; let skipped = 0, dups = 0;
  const seen = new Set();
  if (kind === 'pointages') {
    store.state.pointages.forEach((p) => seen.add(`${p.type_action}|${Math.floor(p._t / 60000)}`));
    for (const r of json) {
      const d = readExcelDate(pickCol(r, ['date', 'jour']));
      const t = readExcelTime(pickCol(r, ['heure', 'horaire', 'time']));
      const a = normAction(pickCol(r, ['action', 'type', 'evenement']));
      if (!d || !t || !a) { skipped++; continue; }
      const dt = new Date(`${d}T${t}:00`);
      if (Number.isNaN(dt.getTime())) { skipped++; continue; }
      const key = `${a}|${Math.floor(dt.getTime() / 60000)}`;
      if (seen.has(key)) { dups++; continue; }
      seen.add(key);
      rows.push({ type_action: a, timestamp: dt.toISOString() });
    }
  } else {
    store.state.absences.forEach((a) => seen.add(`${a.type_absence}|${a.moment}|${a.date_debut}|${a.date_fin}`));
    for (const r of json) {
      const d = readExcelDate(pickCol(r, ['date', 'date debut', 'debut', 'du']));
      const f = readExcelDate(pickCol(r, ['date fin', 'fin', 'au'])) || d;
      const type = normType(pickCol(r, ['type', 'type absence', 'motif']));
      const moment = normMoment(pickCol(r, ['moment', 'duree', 'periode']));
      if (!d || !type || f < d) { skipped++; continue; }
      const row = { type_absence: type, moment, date_debut: d, date_fin: moment === 'journee' ? f : d };
      const key = `${row.type_absence}|${row.moment}|${row.date_debut}|${row.date_fin}`;
      if (seen.has(key)) { dups++; continue; }
      seen.add(key);
      rows.push(row);
    }
  }
  return { rows, skipped, dups, total: json.length };
}

export async function commitImport(kind, rows, onProgress) {
  await store.bulkInsert(kind, rows, onProgress);
  await store.sync({ full: true });
}
