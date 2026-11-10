// Exports : Excel (multi-feuilles), PDF (rapport), rapport imprimable, CSV, calendrier ICS.
import { CDN } from './config.js';
import {
  loadScript, downloadBlob, fmtDur, fmtHM, fmtTime, fmtNum, parseDay, dayKey, weekKey, isoWeek, excelDate, hoursOfDay, HOUR, DAY, MIN, pad, esc, equivalence, capitalize,
} from './util.js';
import { ABSENCE_TYPES, absColor, FERIE_COLOR, momentLabel } from './calc.js';
import * as store from './store.js';
import { buildBar, theme, svgToPng } from './charts.js';

const ACTION_LABEL = { arrivee: 'Arrivée', pause: 'Pause', depart: 'Départ' };
const stamp = (s, e) => `${dayKey(s)}_au_${dayKey(e)}`;

/** Données communes à tous les exports d'une période. */
export function reportData(start, end) {
  const e = store.engine(), now = Date.now();
  const st = e.stats(start, end, now);
  const rows = st.days.map((d) => {
    const pauses = d.pauseStarts.map((t, i) => `${fmtTime(t)}-${d.pauseEnds[i] ? fmtTime(d.pauseEnds[i]) : '…'}`).join(' | ');
    const absTxt = [d.ferie ? `Férié (${d.ferie})` : '', ...d.abs.map((a) => `${a.type_absence}${a.moment !== 'journee' ? ` (${momentLabel(a.moment).toLowerCase()})` : ''}`)].filter(Boolean).join(', ');
    return { ...d, pausesTxt: pauses, absTxt, delta: d.past ? d.real - d.expected : null };
  });
  const year = end.getFullYear();
  const soldes = e.soldes(Math.min(year, new Date().getFullYear()), now);
  return { e, st, rows, soldes, start, end, user: store.state.user?.email || '' };
}

// ====================== EXCEL ======================
export async function exportExcel(start, end) {
  await loadScript(CDN.xlsx);
  const X = window.XLSX;
  const { e, st, rows, soldes } = reportData(start, end);
  const wb = X.utils.book_new();
  const dur = (ms) => (ms == null ? null : ms / DAY);
  const tod = (t) => (t == null ? null : hoursOfDay(t) / 24);
  const dec = (ms) => (ms == null ? null : Math.round((ms / HOUR) * 100) / 100);

  function sheet(name, header, data, fmts, widths, totals = null) {
    const ws = X.utils.aoa_to_sheet([header, ...data]);
    data.forEach((r, ri) => r.forEach((v, ci) => {
      if (fmts[ci] && typeof v === 'number') { const c = ws[X.utils.encode_cell({ r: ri + 1, c: ci })]; if (c) c.z = fmts[ci]; }
    }));
    if (totals && data.length) {
      const r = data.length + 1;
      ws[X.utils.encode_cell({ r, c: 0 })] = { t: 's', v: 'TOTAL' };
      totals.forEach((col) => {
        const L = X.utils.encode_col(col);
        ws[X.utils.encode_cell({ r, c: col })] = { t: 'n', f: `SUM(${L}2:${L}${data.length + 1})`, z: fmts[col] };
      });
      ws['!ref'] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r, c: header.length - 1 } });
    }
    ws['!cols'] = widths.map((w) => ({ wch: w }));
    if (data.length) ws['!autofilter'] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: data.length, c: header.length - 1 } }) };
    X.utils.book_append_sheet(wb, ws, name);
  }

  // 1. Synthèse
  const k = st.kpi;
  const syn = [
    ['Rapport Suivi Heures', ''], ['Période', `du ${start.toLocaleDateString('fr-FR')} au ${end.toLocaleDateString('fr-FR')}`], ['Généré le', new Date().toLocaleString('fr-FR')], ['', ''],
    ['Temps travaillé', fmtDur(k.total)], ['Jours travaillés', k.workedDays], ['Moyenne par jour travaillé', fmtDur(k.avgDay)],
    ['Temps attendu', fmtDur(k.expected)], ['Solde (réel - attendu)', fmtDur(k.balance, { sign: true })],
    ['Arrivée médiane', fmtHM(k.medArrival)], ['Départ médian', fmtHM(k.medDeparture)], ['Pause moyenne par jour', `${Math.round(k.avgPauseDay / MIN)} min`],
    ['Amplitude moyenne', fmtDur(k.avgAmplitude)], ['', ''],
    ['Absences (jours ouvrés)', ''], ...Object.entries(st.absTotals).map(([t, n]) => [`  ${t}`, n]), ['  Jours fériés', st.feriesCount], ['', ''],
    [`Soldes ${soldes.year} à ce jour`, ''], ['  Congés payés restants', soldes.cpRestants], ['  Reliquat N-1 restant', soldes.reliquatRestant],
    ['  RTT restants', soldes.rttRestants], ['  CET', soldes.cetRestants], ['  Jours de fractionnement', soldes.jFrac], ['', ''],
    ['Repères réglementaires', ''], ['  Journées > 10 h', st.compliance.over10.length], ['  Semaines > 48 h', st.compliance.over48.length],
    ['  Repos quotidien < 11 h', st.compliance.shortRest.length], ['  Pause < 20 min après 6 h', st.compliance.shortPause.length],
  ];
  const wsS = X.utils.aoa_to_sheet(syn); wsS['!cols'] = [{ wch: 32 }, { wch: 28 }];
  X.utils.book_append_sheet(wb, wsS, 'Synthèse');

  // 2. Journalier
  const daily = rows.filter((r) => !(r.we && !r.work && !r.abs.length)).map((r) => [
    excelDate(r.date), capitalize(r.date.toLocaleDateString('fr-FR', { weekday: 'long' })), tod(r.first), tod(r.last), r.pausesTxt || '',
    dur(r.pause), dur(r.work), dur(r.credit), dur(r.expected), r.delta == null ? null : dec(r.delta), r.absTxt,
  ]);
  sheet('Journalier', ['Date', 'Jour', 'Arrivée', 'Départ', 'Pauses', 'Durée pauses', 'Travaillé', 'Crédit formation', 'Attendu', 'Écart (h)', 'Absence / férié'], daily,
    ['dd/mm/yyyy', null, 'hh:mm', 'hh:mm', null, '[h]:mm', '[h]:mm', '[h]:mm', '[h]:mm', '+0.00;-0.00;0.00', null], [12, 10, 9, 9, 28, 12, 11, 15, 10, 10, 30], [5, 6, 7, 8, 9]);

  // 3. Hebdomadaire
  sheet('Hebdomadaire', ['Semaine', 'Du', 'Travaillé', 'Attendu', 'Écart (h)'], st.weeks.map((w) => [w.key, excelDate(parseDay(w.start)), dur(w.real), dur(w.expected), dec(w.balance)]),
    [null, 'dd/mm/yyyy', '[h]:mm', '[h]:mm', '+0.00;-0.00;0.00'], [11, 12, 11, 11, 10], [2, 3, 4]);

  // 4. Mensuel
  sheet('Mensuel', ['Mois', 'Travaillé', 'Attendu', 'Écart (h)', 'Jours travaillés', 'Moyenne / jour', 'Arrivée moy.', 'Départ moy.', 'Pause moy. (min)', 'Absences (j)'],
    st.months.map((m) => [m.label, dur(m.real), dur(m.expected), dec(m.balance), m.workedDays, m.workedDays ? dur(m.work / m.workedDays) : null,
      m.arrAvg == null ? null : m.arrAvg / 24, m.depAvg == null ? null : m.depAvg / 24, Math.round(m.pauseAvgMin), Object.values(m.abs).reduce((a, b) => a + b, 0)]),
    [null, '[h]:mm', '[h]:mm', '+0.00;-0.00;0.00', '0', '[h]:mm', 'hh:mm', 'hh:mm', '0', '0.0'], [10, 11, 11, 10, 15, 14, 12, 12, 15, 12], [1, 2, 3, 4, 9]);

  // 5. Pointages bruts (format ré-importable : Date / Heure / Action)
  const s0 = start.getTime(), e0 = end.getTime() + DAY;
  const raw = store.state.pointages.filter((p) => p._t >= s0 && p._t < e0).map((p) => [excelDate(new Date(p._t)), tod(p._t), ACTION_LABEL[p.type_action] || p.type_action]);
  sheet('Pointages', ['Date', 'Heure', 'Action'], raw, ['dd/mm/yyyy', 'hh:mm', null], [12, 8, 10]);

  // 6. Absences (format ré-importable : Date / Date fin / Type / Moment)
  const sk = dayKey(start), ek = dayKey(end);
  const abs = store.state.absences.filter((a) => a.date_debut <= ek && (a.date_fin || a.date_debut) >= sk)
    .sort((a, b) => a.date_debut.localeCompare(b.date_debut))
    .map((a) => [excelDate(parseDay(a.date_debut)), excelDate(parseDay(a.date_fin || a.date_debut)), a.type_absence, a.moment || 'journee', e.absenceDays(a, start, end)]);
  sheet('Absences', ['Date', 'Date fin', 'Type', 'Moment', 'Jours ouvrés'], abs, ['dd/mm/yyyy', 'dd/mm/yyyy', null, null, '0.0'], [12, 12, 12, 10, 12], [4]);

  X.writeFile(wb, `Suivi-heures_${stamp(start, end)}.xlsx`, { compression: true });
}

// ====================== CSV ======================
export function exportCSV(start, end) {
  const s0 = start.getTime(), e0 = end.getTime() + DAY;
  const lines = ['Date;Heure;Action;Horodatage ISO'];
  for (const p of store.state.pointages) {
    if (p._t < s0 || p._t >= e0) continue;
    const d = new Date(p._t);
    lines.push(`${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()};${fmtTime(p._t)};${ACTION_LABEL[p.type_action] || p.type_action};${p.timestamp}`);
  }
  downloadBlob(`Pointages_${stamp(start, end)}.csv`, new Blob(['﻿', lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  return lines.length - 1;
}

// ====================== ICS (absences → agenda) ======================
export function exportICS(start, end) {
  const sk = dayKey(start), ek = dayKey(end);
  const ics = (k) => k.replace(/-/g, '');
  const nowS = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const ev = store.state.absences.filter((a) => a.date_debut <= ek && (a.date_fin || a.date_debut) >= sk).map((a) => {
    const endK = dayKey(new Date(parseDay(a.date_fin || a.date_debut).getTime() + DAY + 3600000));
    return ['BEGIN:VEVENT', `UID:abs-${a.id}@suivi-heures`, `DTSTAMP:${nowS}`, `DTSTART;VALUE=DATE:${ics(a.date_debut)}`, `DTEND;VALUE=DATE:${ics(endK)}`,
      `SUMMARY:${a.type_absence}${a.moment !== 'journee' ? ` (${momentLabel(a.moment).toLowerCase()})` : ''}`, 'TRANSP:TRANSPARENT', 'END:VEVENT'].join('\r\n');
  });
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Suivi Heures//FR', 'CALSCALE:GREGORIAN', ...ev, 'END:VCALENDAR'].join('\r\n');
  downloadBlob(`Absences_${stamp(start, end)}.ics`, new Blob([body], { type: 'text/calendar;charset=utf-8' }));
  return ev.length;
}

// ====================== Modèles d'import ======================
export async function downloadTemplate(kind) {
  await loadScript(CDN.xlsx);
  const X = window.XLSX;
  const wb = X.utils.book_new();
  const data = kind === 'pointages'
    ? [['Date', 'Heure', 'Action'], ['03/11/2025', '08:30', 'Arrivée'], ['03/11/2025', '12:00', 'Pause'], ['03/11/2025', '12:45', 'Arrivée'], ['03/11/2025', '17:15', 'Départ']]
    : [['Date', 'Date fin', 'Type', 'Moment'], ['10/11/2025', '14/11/2025', 'CP', 'journee'], ['21/11/2025', '', 'RTT', 'matin']];
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(data), kind === 'pointages' ? 'Pointages' : 'Absences');
  X.writeFile(wb, `Modele_import_${kind}.xlsx`);
}

// ====================== Rapport (modèle de la v1 : indicateurs + 3 graphiques) ======================
/** Regroupe la période par jour (≤ 60 jours) ou par semaine, comme le rapport d'origine. */
function reportGroups(R) {
  const { st, e, start, end } = R;
  const byWeek = (end - start) / DAY > 60;
  const groups = new Map();
  for (const d of st.days) {
    const key = byWeek ? weekKey(d.date) : d.key;
    if (!groups.has(key)) {
      const w = isoWeek(d.date);
      groups.set(key, { label: byWeek ? `S${pad(w.week)} ${String(w.year).slice(2)}` : d.date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }), work: 0, pause: 0, expected: 0, real: 0, worked: 0, past: false, abs: {}, feries: 0 });
    }
    const g = groups.get(key);
    g.work += d.work; g.pause += d.pause; g.real += d.real;
    if (d.past) { g.expected += d.expected; g.past = true; }
    if (d.work) g.worked++;
    if (d.ferie && !d.we) g.feries++;
    if (!d.we && !d.ferie) for (const a of d.abs) g.abs[a.type_absence] = (g.abs[a.type_absence] || 0) + (a.moment === 'journee' ? 1 : 0.5);
  }
  return { byWeek, list: [...groups.values()], pauseRefH: (e.prefs.pauseRefMin || 45) / 60 };
}

function reportCharts(R, width) {
  const th = theme(true);
  const { byWeek, list, pauseRefH } = reportGroups(R);
  const labels = list.map((g) => g.label);
  const H = (ms) => ms / HOUR;
  const evolSeries = [{ name: 'Heures travaillées', color: '#4f46e5', values: list.map((g) => H(g.work)) }, { name: 'Durée pauses', color: '#f97316', values: list.map((g) => H(g.pause)) }];
  const evolLines = [{ name: 'Objectif travail', color: '#9ca3af', dash: '6 5', values: list.map((g) => (g.past && (g.expected || g.work) ? H(g.expected) : null)) }, { name: `Réf. pause (${Math.round(pauseRefH * 60)} min)`, color: '#fdba74', dash: '3 3', width: 1.5, values: list.map((g) => (g.worked ? pauseRefH * g.worked : null)) }];
  const evol = buildBar({ labels, width, height: 260, th, stacked: true, series: evolSeries, lines: evolLines, yFormat: (v) => fmtHM(v) });
  const repSeries = [
    { name: 'Heures normales', color: '#14b8a6', values: list.map((g) => H(Math.min(g.real, g.expected))) },
    { name: 'Heures sup.', color: '#84cc16', values: list.map((g) => H(Math.max(0, g.real - g.expected))) },
    { name: 'Heures manquantes', color: '#fca5a5', values: list.map((g) => H(Math.max(0, g.expected - g.real))) },
  ];
  const rep = buildBar({ labels, width, height: 260, th, stacked: true, series: repSeries, yFormat: (v) => fmtHM(v) });
  const types = [...Object.keys(ABSENCE_TYPES)];
  const absSeries = [...types.map((t) => ({ name: t, color: absColor(t), values: list.map((g) => g.abs[t] || 0) })), { name: 'Jours fériés', color: FERIE_COLOR, values: list.map((g) => g.feries) }];
  const abs = buildBar({ labels, width, height: 260, th, stacked: true, series: absSeries, yFormat: (v) => `${fmtNum(v)} j` });
  return {
    byWeek,
    charts: [
      { title: 'Évolution du temps de travail et des pauses', h: 260, svg: evol.svg, series: [...evolSeries, ...evolLines] },
      { title: 'Répartition (heures normales, sup., manquantes)', h: 260, svg: rep.svg, series: repSeries },
      { title: 'Répartition des absences (en jours)', h: 260, svg: abs.svg, series: absSeries.filter((s) => s.values.some((v) => v)) },
    ],
  };
}

/** Les 4 indicateurs du rapport d'origine. */
function reportKpis(R) {
  const { st, e, start, end } = R, k = st.kpi;
  const hpdH = e.hpdMs(dayKey(new Date())) / HOUR;
  const perDay = (ms) => (k.workedDays ? `${fmtDur(ms / k.workedDays, { sign: ms < 0 })} / jour` : '--');
  const avgPause = k.nbPauses ? Math.round(st.days.reduce((s, d) => s + d.pause, 0) / k.nbPauses / MIN) : 0;
  const pts = e.ponts(start, end);
  const abs = Object.entries(st.absTotals).map(([t, n]) => `${t} : ${fmtNum(n)} j`);
  if (st.feriesCount) abs.push(`Férié : ${st.feriesCount} j`);
  return {
    hpdH, pts,
    cards: [
      { label: 'Heures travaillées', value: fmtDur(k.total), lines: [perDay(k.total)] },
      { label: 'Écart (sup. / manquant)', value: fmtDur(k.balance, { sign: true }), color: k.balance >= 0 ? '#0d9488' : '#e11d48', lines: [perDay(k.balance), equivalence(k.balance / HOUR, hpdH) ? `Soit ${equivalence(k.balance / HOUR, hpdH)}` : ''] },
      { label: 'Pauses (total)', value: String(k.nbPauses), color: '#f97316', lines: [`${avgPause >= 60 ? fmtDur(avgPause * MIN) : `${avgPause} min`} en moyenne`] },
      { label: 'Absences posées', value: '', lines: [...(abs.length ? abs : ['Aucune absence']), ...(pts.possibles ? [`Ponts (1 j) : ${pts.poses} sur ${pts.possibles} poss.`] : [])] },
    ],
  };
}

// ====================== PDF (jsPDF, téléchargement direct) ======================
const pdfText = (s) => String(s ?? '').replace(/[  ]/g, ' ').replace(/≈/g, '~').replace(/[▲▼]/g, '').replace(/→/g, '->').replace(/[^\x00-\xff€–—…‘’“”•]/g, '');

export async function exportPDF(start, end, { detail = false } = {}) {
  await loadScript(CDN.jspdf);
  const { jsPDF } = window.jspdf;
  const R = reportData(start, end);
  const { st, rows } = R, k = st.kpi;
  const { charts, byWeek } = reportCharts(R, 900);
  const K = reportKpis(R);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 12, CW = W - 2 * M;
  const T = (s, x, y, o) => doc.text(pdfText(s), x, y, o);

  // En-tête
  doc.setTextColor('#1f2937'); doc.setFont('helvetica', 'bold'); doc.setFontSize(19); T("Rapport d'Activité RH", M, 16);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor('#6b7280');
  T(`Période : du ${start.toLocaleDateString('fr-FR')} au ${end.toLocaleDateString('fr-FR')} (${byWeek ? 'par semaine' : 'par jour'})`, M, 22.5);
  doc.setDrawColor('#4f46e5'); doc.setLineWidth(0.7); doc.line(M, 26, M + CW, 26); doc.setLineWidth(0.2);
  let y = 31;

  // 4 indicateurs
  const bw = (CW - 9) / 4, bh = 30;
  K.cards.forEach((c, i) => {
    const x = M + i * (bw + 3);
    doc.setFillColor('#f9fafb'); doc.setDrawColor('#e5e7eb'); doc.roundedRect(x, y, bw, bh, 2, 2, 'FD');
    doc.setTextColor('#6b7280'); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.8); T(c.label.toUpperCase(), x + 3, y + 5);
    let yy = y + 5;
    if (c.value) { doc.setTextColor(c.color || '#4338ca'); doc.setFontSize(15); T(c.value, x + 3, y + 13); yy = y + 13; }
    doc.setFont('helvetica', c.value ? 'normal' : 'normal'); doc.setFontSize(c.value ? 7.8 : 7.6);
    c.lines.filter(Boolean).slice(0, c.value ? 3 : 6).forEach((l, j) => {
      doc.setTextColor(l.startsWith('Ponts') ? '#059669' : l.startsWith('Soit') ? (k.balance >= 0 ? '#0f766e' : '#e11d48') : '#6b7280');
      T(l, x + 3, yy + (c.value ? 5 : 4.2) + j * (c.value ? 4.2 : 3.8));
    });
  });
  y += bh + 4;
  doc.setFillColor('#eef2ff'); doc.roundedRect(M, y, CW, 8, 1.5, 1.5, 'F');
  doc.setFontSize(8.5); doc.setTextColor('#3730a3');
  doc.setFont('helvetica', 'bold'); T('Base de calcul :', M + 3, y + 5.3); doc.setFont('helvetica', 'normal'); T(`${fmtHM(K.hpdH)} / jour attendues.`, M + 27, y + 5.3);
  doc.setFont('helvetica', 'bold'); T('Pause de référence :', M + CW - 50, y + 5.3); doc.setFont('helvetica', 'normal'); T(`${R.e.prefs.pauseRefMin || 45} min le midi.`, M + CW - 18, y + 5.3);
  y += 13;

  // 3 graphiques
  for (const ch of charts) {
    const hmm = (CW * ch.h) / 900;
    if (y + hmm + 9 > 290) { doc.addPage(); y = 14; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor('#374151'); T(ch.title, M, y + 3);
    let lx = M; y += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.2);
    ch.series.forEach((s) => { const w = doc.getTextWidth(pdfText(s.name)) + 7; if (lx + w > M + CW) { lx = M; y += 3.8; } doc.setFillColor(s.color); doc.rect(lx, y - 2.2, 4, 2.4, 'F'); doc.setTextColor('#4b5563'); T(s.name, lx + 5, y); lx += w + 2; });
    const png = await svgToPng(ch.svg, 900, ch.h);
    doc.addImage(png, 'PNG', M, y + 1.5, CW, hmm);
    y += hmm + 6;
  }

  // Annexe optionnelle : détail journalier
  if (detail) {
    doc.addPage(); y = 16;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor('#0f172a'); T('Détail journalier', M, y); y += 6;
    const cols = [['Date', 25], ['Arrivée', 15], ['Départ', 15], ['Pauses', 48], ['Travaillé', 17], ['Attendu', 17], ['Écart', 15], ['Absence / férié', 34]];
    const head = () => {
      doc.setFillColor('#4f46e5'); doc.rect(M, y, CW, 7, 'F');
      doc.setTextColor('#ffffff'); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
      let x = M + 1.5; cols.forEach(([h, w]) => { T(h, x, y + 4.8); x += w; });
      y += 7; doc.setFont('helvetica', 'normal');
    };
    head();
    rows.filter((r) => !(r.we && !r.work && !r.abs.length)).forEach((r, i) => {
      if (y > 282) { doc.addPage(); y = 16; head(); }
      if (i % 2) { doc.setFillColor('#f8fafc'); doc.rect(M, y, CW, 6, 'F'); }
      const cells = [r.date.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' }), r.first ? fmtTime(r.first) : '', r.last ? fmtTime(r.last) : '',
        r.pausesTxt, r.work ? fmtDur(r.work) : '', r.expected ? fmtDur(r.expected) : '', r.delta != null && (r.work || r.expected) ? fmtDur(r.delta, { sign: true }) : '', r.absTxt];
      let x = M + 1.5; doc.setFontSize(7.5);
      cells.forEach((v, ci) => {
        doc.setTextColor(ci === 6 && r.delta != null ? (r.delta >= 0 ? '#059669' : '#e11d48') : r.we ? '#94a3b8' : '#1e293b');
        let t = pdfText(v); const maxW = cols[ci][1] - 2;
        while (t && doc.getTextWidth(t) > maxW) t = t.slice(0, -2);
        T(t, x, y + 4.2); x += cols[ci][1];
      });
      y += 6;
    });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor('#0f172a');
    T(`Total : ${fmtDur(k.total)} travaillées · ${fmtDur(k.expected)} attendues · écart ${fmtDur(k.balance, { sign: true })}`, M, Math.min(y + 6, 290));
  }

  const n = doc.internal.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor('#9ca3af');
    T(`${R.user} · généré le ${new Date().toLocaleDateString('fr-FR')}`, M, 292); T(`Page ${i} / ${n}`, W - M, 292, { align: 'right' });
  }
  doc.save(`Rapport_SIRH_${stamp(start, end)}.pdf`);
}

// ====================== Rapport imprimable (même mise en page, HTML → Imprimer / PDF) ======================
export function printableReport(start, end, { detail = false } = {}) {
  const R = reportData(start, end);
  const { st, rows } = R, k = st.kpi;
  const { charts, byWeek } = reportCharts(R, 900);
  const K = reportKpis(R);
  const list = rows.filter((r) => !(r.we && !r.work && !r.abs.length));
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Rapport ${dayKey(start)} - ${dayKey(end)}</title>
<style>
  @page { size: A4; margin: 10mm; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #1f2937; margin: 0 auto; max-width: 900px; padding: 24px; font-size: 12px; }
  h1 { font-size: 26px; margin: 0; } .per { color: #6b7280; font-size: 15px; margin-top: 4px; }
  .head { border-bottom: 3px solid #4f46e5; padding-bottom: 12px; margin-bottom: 18px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 18px; }
  .k { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 12px; }
  .k .l { font-size: 10px; text-transform: uppercase; color: #6b7280; font-weight: 700; margin-bottom: 4px; }
  .k .v { font-size: 22px; font-weight: 750; color: #4338ca; } .k .s { font-size: 11.5px; color: #6b7280; margin-top: 3px; } .k .s.p { color: #059669; font-weight: 700; }
  .band { background: #eef2ff; color: #3730a3; padding: 9px 12px; border-radius: 8px; display: flex; justify-content: space-between; margin-bottom: 16px; font-size: 12.5px; }
  h3 { font-size: 14px; color: #374151; margin: 14px 0 4px; }
  .lg { display: flex; flex-wrap: wrap; gap: 12px; font-size: 11px; color: #4b5563; margin-bottom: 4px; } .lg i { display: inline-block; width: 12px; height: 8px; margin-right: 5px; }
  svg { width: 100%; height: auto; } .chart { break-inside: avoid; }
  table { width: 100%; border-collapse: collapse; font-size: 10.5px; margin-top: 8px; }
  th { background: #4f46e5; color: #fff; text-align: left; padding: 5px 6px; } td { padding: 4px 6px; border-bottom: 1px solid #e5e7eb; }
  tr:nth-child(even) td { background: #f8fafc; } td.we { color: #94a3b8; } .num { text-align: right; font-variant-numeric: tabular-nums; } .pos { color: #059669; } .neg { color: #e11d48; }
  thead { display: table-header-group; } tr { break-inside: avoid; }
  .actions { position: fixed; top: 12px; right: 12px; } .actions button { font: inherit; padding: 8px 14px; border-radius: 8px; border: 0; background: #4f46e5; color: #fff; cursor: pointer; }
  @media print { .actions { display: none; } body { padding: 0; } }
</style></head><body>
<div class="actions"><button onclick="window.print()">Imprimer / Enregistrer en PDF</button></div>
<div class="head"><h1>Rapport d'Activité RH</h1><div class="per">Période : du ${start.toLocaleDateString('fr-FR')} au ${end.toLocaleDateString('fr-FR')} (${byWeek ? 'Par semaine' : 'Par jour'})</div></div>
<div class="kpis">${K.cards.map((c) => `<div class="k"><div class="l">${esc(c.label)}</div>${c.value ? `<div class="v" style="color:${c.color || '#4338ca'}">${esc(c.value)}</div>` : ''}${c.lines.filter(Boolean).map((l) => `<div class="s${l.startsWith('Ponts') ? ' p' : ''}"${l.startsWith('Soit') ? ` style="color:${k.balance >= 0 ? '#0f766e' : '#e11d48'};font-weight:700"` : ''}>${esc(l)}</div>`).join('')}</div>`).join('')}</div>
<div class="band"><span><b>Base de calcul :</b> ${fmtHM(K.hpdH)} / jour attendues.</span><span><b>Pause de référence :</b> ${R.e.prefs.pauseRefMin || 45} min le midi.</span></div>
${charts.map((c) => `<div class="chart"><h3>${esc(c.title)}</h3><div class="lg">${c.series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>${c.svg}</div>`).join('')}
${detail ? `<h3 style="break-before: page">Détail journalier</h3>
<table><thead><tr><th>Date</th><th>Arrivée</th><th>Départ</th><th>Pauses</th><th class="num">Travaillé</th><th class="num">Attendu</th><th class="num">Écart</th><th>Absence / férié</th></tr></thead><tbody>
${list.map((r) => `<tr><td class="${r.we ? 'we' : ''}">${r.date.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', year: '2-digit' })}</td><td>${r.first ? fmtTime(r.first) : ''}</td><td>${r.last ? fmtTime(r.last) : ''}</td><td>${esc(r.pausesTxt)}</td><td class="num">${r.work ? fmtDur(r.work) : ''}</td><td class="num">${r.expected ? fmtDur(r.expected) : ''}</td><td class="num ${r.delta >= 0 ? 'pos' : 'neg'}">${r.delta != null && (r.work || r.expected) ? fmtDur(r.delta, { sign: true }) : ''}</td><td>${esc(r.absTxt)}</td></tr>`).join('')}
</tbody></table>` : ''}
</body></html>`;
  const w = window.open('', '_blank');
  if (!w) { downloadBlob(`Rapport_${stamp(start, end)}.html`, new Blob([html], { type: 'text/html' })); return html; }
  w.document.open(); w.document.write(html); w.document.close();
  return html;
}
