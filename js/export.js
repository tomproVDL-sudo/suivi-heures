// Exports : Excel (multi-feuilles), PDF (rapport), rapport imprimable, CSV, calendrier ICS.
import { CDN } from './config.js';
import {
  loadScript, downloadBlob, fmtDur, fmtHM, fmtTime, fmtNum, parseDay, dayKey, excelDate, hoursOfDay, HOUR, DAY, MIN, pad, esc, equivalence, capitalize,
} from './util.js';
import { ABSENCE_TYPES, absColor, FERIE_COLOR, momentLabel } from './calc.js';
import * as store from './store.js';
import { buildBar, buildLine, theme, svgToPng } from './charts.js';

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

// ====================== Graphiques du rapport ======================
function reportCharts(st, width) {
  const th = theme(true);
  const byWeek = st.months.length <= 3;
  const rows = byWeek ? st.weeks : st.months;
  const vol = buildBar({
    labels: rows.map((r) => r.label), width, height: 260, th, yFormat: (v) => `${Math.round(v)} h`,
    series: [{ name: 'Travaillé', color: '#14b8a6', values: rows.map((r) => r.real / HOUR) }],
    lines: [{ name: 'Attendu', color: '#64748b', dash: '6 4', values: rows.map((r) => (r.expected ? r.expected / HOUR : null)) }],
  });
  const step = Math.max(1, Math.ceil(st.cumul.length / 120));
  const cum = st.cumul.filter((_, i) => i % step === 0 || i === st.cumul.length - 1);
  const last = cum[cum.length - 1]?.value ?? 0;
  const cumul = buildLine({
    labels: cum.map((c) => parseDay(c.key).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })), width, height: 220, th,
    series: [{ name: 'Solde', color: last >= 0 ? '#10b981' : '#ef4444', values: cum.map((c) => c.value), area: true, dots: false }], yFormat: (v) => fmtHM(v), includeZero: true,
  });
  const types = Object.keys(ABSENCE_TYPES);
  const ms = st.months;
  const absSeries = [...types.map((t) => ({ name: t, color: absColor(t), values: ms.map((m) => m.abs[t] || 0) })), { name: 'Fériés', color: FERIE_COLOR, values: ms.map((m) => m.feries) }].filter((s) => s.values.some((v) => v));
  const abs = absSeries.length ? buildBar({ labels: ms.map((m) => m.label), width, height: 220, th, stacked: true, series: absSeries, yFormat: (v) => `${fmtNum(v)} j` }) : null;
  return { vol: { ...vol, h: 260, series: [{ name: 'Travaillé', color: '#14b8a6' }, { name: 'Attendu', color: '#64748b' }] }, cumul: { ...cumul, h: 220 }, abs: abs ? { ...abs, h: 220, series: absSeries } : null, byWeek };
}

// ====================== PDF (jsPDF, téléchargement direct) ======================
const pdfText = (s) => String(s ?? '').replace(/[  ]/g, ' ').replace(/≈/g, '~').replace(/[▲▼]/g, '').replace(/→/g, '->').replace(/[^\x00-\xff€–—…‘’“”•]/g, '');

export async function exportPDF(start, end) {
  await loadScript(CDN.jspdf);
  const { jsPDF } = window.jspdf;
  const R = reportData(start, end);
  const { st, rows, soldes } = R, k = st.kpi;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 14, CW = W - 2 * M;
  const T = (s, x, y, o) => doc.text(pdfText(s), x, y, o);
  const hpdH = R.e.hpdMs(dayKey(new Date())) / HOUR;

  // En-tête
  doc.setFillColor('#0d9488'); doc.rect(0, 0, W, 30, 'F');
  doc.setTextColor('#ffffff'); doc.setFont('helvetica', 'bold'); doc.setFontSize(18); T("Rapport d'activité", M, 14);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  T(`Du ${start.toLocaleDateString('fr-FR')} au ${end.toLocaleDateString('fr-FR')}`, M, 21);
  T(`${R.user} · généré le ${new Date().toLocaleDateString('fr-FR')}`, M, 26);
  let y = 38;

  // Indicateurs
  const kpis = [
    ['Temps travaillé', fmtDur(k.total), `${k.workedDays} jours travaillés`],
    ['Solde de la période', fmtDur(k.balance, { sign: true }), equivalence(k.balance / HOUR, hpdH) || `attendu ${fmtDur(k.expected)}`],
    ['Moyenne / jour', fmtDur(k.avgDay), `base ${fmtHM(hpdH)} / jour`],
    ['Pause moyenne / jour', `${Math.round(k.avgPauseDay / MIN)} min`, `${k.nbPauses} pauses`],
    ['Arrivée médiane', fmtHM(k.medArrival), `plus tôt ${fmtHM(k.earliest)}`],
    ['Départ médian', fmtHM(k.medDeparture), `plus tard ${fmtHM(k.latest)}`],
    ['Amplitude moyenne', fmtDur(k.avgAmplitude), ''],
    ['Journée la plus longue', k.longest ? fmtDur(k.longest.ms) : '--', k.longest ? parseDay(k.longest.key).toLocaleDateString('fr-FR') : ''],
  ];
  const bw = (CW - 9) / 4, bh = 20;
  kpis.forEach(([label, val, sub], i) => {
    const x = M + (i % 4) * (bw + 3), yy = y + Math.floor(i / 4) * (bh + 3);
    doc.setFillColor('#f1f5f9'); doc.roundedRect(x, yy, bw, bh, 2, 2, 'F');
    doc.setTextColor('#64748b'); doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); T(label.toUpperCase(), x + 3, yy + 5);
    doc.setTextColor(i === 1 ? (k.balance >= 0 ? '#059669' : '#e11d48') : '#0f172a'); doc.setFontSize(13); doc.setFont('helvetica', 'bold'); T(val, x + 3, yy + 12.5);
    doc.setTextColor('#64748b'); doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); T(sub, x + 3, yy + 17);
  });
  y += 2 * (bh + 3) + 4;

  // Soldes & absences
  doc.setFillColor('#f0fdfa'); doc.roundedRect(M, y, CW, 15, 2, 2, 'F');
  doc.setFontSize(8.5); doc.setTextColor('#0f766e'); doc.setFont('helvetica', 'bold'); T(`Soldes ${soldes.year} à ce jour`, M + 3, y + 5.5);
  doc.setFont('helvetica', 'normal'); doc.setTextColor('#334155');
  T(`CP : ${fmtNum(soldes.cpRestants)} j  ·  Reliquat N-1 : ${fmtNum(soldes.reliquatRestant)} j  ·  RTT : ${fmtNum(soldes.rttRestants)} j  ·  CET : ${fmtNum(soldes.cetRestants)} j  ·  Fractionnement : +${soldes.jFrac} j`, M + 3, y + 11);
  y += 19;
  const absTxt = Object.entries(st.absTotals).map(([t, n]) => `${t} ${fmtNum(n)} j`).join('  ·  ');
  doc.setFontSize(8.5); doc.setTextColor('#334155');
  T(`Absences sur la période : ${absTxt || 'aucune'}${st.feriesCount ? `  ·  Fériés ${st.feriesCount} j` : ''}`, M, y); y += 5;
  const c = st.compliance;
  T(`Repères : ${c.over10.length} journée(s) > 10 h · ${c.over48.length} semaine(s) > 48 h · ${c.shortRest.length} repos < 11 h · ${c.shortPause.length} pause(s) < 20 min après 6 h`, M, y); y += 6;

  // Graphiques
  const charts = reportCharts(st, 900);
  const addChart = async (title, ch) => {
    if (!ch) return;
    const hmm = (CW * ch.h) / 900;
    if (y + hmm + 10 > 285) { doc.addPage(); y = 16; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor('#0f172a'); T(title, M, y + 4);
    let lx = M + CW;
    (ch.series || []).slice().reverse().forEach((s) => { const w = doc.getTextWidth(pdfText(s.name)) + 6; lx -= w; doc.setFillColor(s.color); doc.rect(lx, y + 1.5, 2.5, 2.5, 'F'); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor('#475569'); T(s.name, lx + 3.5, y + 3.8); });
    const png = await svgToPng(ch.svg, 900, ch.h);
    doc.addImage(png, 'PNG', M, y + 6, CW, hmm);
    y += hmm + 10;
  };
  await addChart(`Heures travaillées / attendues (${charts.byWeek ? 'par semaine' : 'par mois'})`, charts.vol);
  await addChart('Solde cumulé (heures)', charts.cumul);
  await addChart('Absences et jours fériés (jours ouvrés)', charts.abs);

  // Tableau journalier
  doc.addPage(); y = 16;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor('#0f172a'); T('Détail journalier', M, y); y += 6;
  const cols = [['Date', 24], ['Arrivée', 15], ['Départ', 15], ['Pauses', 46], ['Travaillé', 17], ['Attendu', 17], ['Écart', 15], ['Absence / férié', 33]];
  const head = () => {
    doc.setFillColor('#0f766e'); doc.rect(M, y, CW, 7, 'F');
    doc.setTextColor('#ffffff'); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    let x = M + 1.5; cols.forEach(([h, w]) => { T(h, x, y + 4.8); x += w; });
    y += 7; doc.setFont('helvetica', 'normal');
  };
  head();
  const list = rows.filter((r) => !(r.we && !r.work && !r.abs.length));
  list.forEach((r, i) => {
    if (y > 282) { doc.addPage(); y = 16; head(); }
    if (i % 2) { doc.setFillColor('#f8fafc'); doc.rect(M, y, CW, 6, 'F'); }
    const cells = [
      r.date.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' }), r.first ? fmtTime(r.first) : '', r.last ? fmtTime(r.last) : '',
      r.pausesTxt, r.work ? fmtDur(r.work) : '', r.expected ? fmtDur(r.expected) : '', r.delta != null && (r.work || r.expected) ? fmtDur(r.delta, { sign: true }) : '', r.absTxt,
    ];
    let x = M + 1.5;
    doc.setFontSize(7.5);
    cells.forEach((v, ci) => {
      doc.setTextColor(ci === 6 && r.delta != null ? (r.delta >= 0 ? '#059669' : '#e11d48') : r.we ? '#94a3b8' : '#1e293b');
      let s = pdfText(v); const maxW = cols[ci][1] - 2;
      while (s && doc.getTextWidth(s) > maxW) s = s.slice(0, -2);
      T(s, x, y + 4.2); x += cols[ci][1];
    });
    y += 6;
  });
  if (y > 276) { doc.addPage(); y = 16; }
  doc.setDrawColor('#0f766e'); doc.line(M, y + 1, M + CW, y + 1);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor('#0f172a');
  T(`Total : ${fmtDur(k.total)} travaillées · ${fmtDur(k.expected)} attendues · solde ${fmtDur(k.balance, { sign: true })}`, M, y + 6);

  // Pieds de page
  const n = doc.internal.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor('#94a3b8');
    T('Suivi Heures', M, 292); T(`Page ${i} / ${n}`, W - M, 292, { align: 'right' });
  }
  doc.save(`Rapport_${stamp(start, end)}.pdf`);
}

// ====================== Rapport imprimable (HTML → Imprimer / Enregistrer en PDF) ======================
export function printableReport(start, end) {
  const R = reportData(start, end);
  const { st, rows, soldes } = R, k = st.kpi;
  const hpdH = R.e.hpdMs(dayKey(new Date())) / HOUR;
  const charts = reportCharts(st, 900);
  const kp = (l, v, s, cls = '') => `<div class="k"><div class="l">${esc(l)}</div><div class="v ${cls}">${esc(v)}</div><div class="s">${esc(s)}</div></div>`;
  const legend = (ser) => (ser || []).map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('');
  const list = rows.filter((r) => !(r.we && !r.work && !r.abs.length));
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Rapport ${dayKey(start)} - ${dayKey(end)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #0f172a; margin: 0; font-size: 12px; }
  header { background: #0d9488; color: #fff; padding: 16px 20px; border-radius: 10px; }
  header h1 { margin: 0 0 4px; font-size: 22px; } header div { opacity: .9; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 14px 0; }
  .k { background: #f1f5f9; border-radius: 8px; padding: 9px 11px; }
  .k .l { font-size: 9.5px; text-transform: uppercase; color: #64748b; font-weight: 600; letter-spacing: .03em; }
  .k .v { font-size: 18px; font-weight: 750; margin-top: 2px; } .k .s { font-size: 10.5px; color: #64748b; }
  .pos { color: #059669; } .neg { color: #e11d48; }
  .box { background: #f0fdfa; border-radius: 8px; padding: 9px 12px; margin-bottom: 8px; }
  h2 { font-size: 14px; margin: 16px 0 6px; display: flex; justify-content: space-between; align-items: center; }
  .lg { font-size: 10.5px; font-weight: 500; color: #475569; display: flex; gap: 10px; }
  .lg i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 4px; }
  svg { width: 100%; height: auto; }
  .chart { break-inside: avoid; }
  table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  th { background: #0f766e; color: #fff; text-align: left; padding: 5px 6px; } td { padding: 4px 6px; border-bottom: 1px solid #e2e8f0; }
  tr:nth-child(even) td { background: #f8fafc; } td.we { color: #94a3b8; } .num { text-align: right; font-variant-numeric: tabular-nums; }
  thead { display: table-header-group; } tr { break-inside: avoid; }
  .actions { position: fixed; top: 12px; right: 12px; } .actions button { font: inherit; padding: 8px 14px; border-radius: 8px; border: 0; background: #0f172a; color: #fff; cursor: pointer; }
  @media print { .actions { display: none; } }
</style></head><body>
<div class="actions"><button onclick="window.print()">Imprimer / Enregistrer en PDF</button></div>
<header><h1>Rapport d'activité</h1><div>Du ${start.toLocaleDateString('fr-FR')} au ${end.toLocaleDateString('fr-FR')} · ${esc(R.user)} · généré le ${new Date().toLocaleDateString('fr-FR')}</div></header>
<div class="kpis">
  ${kp('Temps travaillé', fmtDur(k.total), `${k.workedDays} jours travaillés`)}
  ${kp('Solde de la période', fmtDur(k.balance, { sign: true }), equivalence(k.balance / HOUR, hpdH) || `attendu ${fmtDur(k.expected)}`, k.balance >= 0 ? 'pos' : 'neg')}
  ${kp('Moyenne / jour', fmtDur(k.avgDay), `base ${fmtHM(hpdH)} / jour`)}
  ${kp('Pause moyenne / jour', `${Math.round(k.avgPauseDay / MIN)} min`, `${k.nbPauses} pauses`)}
  ${kp('Arrivée médiane', fmtHM(k.medArrival), `plus tôt ${fmtHM(k.earliest)}`)}
  ${kp('Départ médian', fmtHM(k.medDeparture), `plus tard ${fmtHM(k.latest)}`)}
  ${kp('Amplitude moyenne', fmtDur(k.avgAmplitude), '')}
  ${kp('Journée la plus longue', k.longest ? fmtDur(k.longest.ms) : '--', k.longest ? parseDay(k.longest.key).toLocaleDateString('fr-FR') : '')}
</div>
<div class="box"><b>Soldes ${soldes.year} à ce jour</b> — CP ${fmtNum(soldes.cpRestants)} j · Reliquat N-1 ${fmtNum(soldes.reliquatRestant)} j · RTT ${fmtNum(soldes.rttRestants)} j · CET ${fmtNum(soldes.cetRestants)} j · Fractionnement +${soldes.jFrac} j</div>
<div class="box" style="background:#f8fafc"><b>Absences</b> — ${Object.entries(st.absTotals).map(([t, n]) => `${esc(t)} ${fmtNum(n)} j`).join(' · ') || 'aucune'}${st.feriesCount ? ` · Fériés ${st.feriesCount} j` : ''}<br>
<b>Repères</b> — ${st.compliance.over10.length} journée(s) &gt; 10 h · ${st.compliance.over48.length} semaine(s) &gt; 48 h · ${st.compliance.shortRest.length} repos &lt; 11 h · ${st.compliance.shortPause.length} pause(s) &lt; 20 min après 6 h</div>
<div class="chart"><h2>Heures travaillées / attendues (${charts.byWeek ? 'par semaine' : 'par mois'})<span class="lg">${legend(charts.vol.series)}</span></h2>${charts.vol.svg}</div>
<div class="chart"><h2>Solde cumulé</h2>${charts.cumul.svg}</div>
${charts.abs ? `<div class="chart"><h2>Absences et jours fériés<span class="lg">${legend(charts.abs.series)}</span></h2>${charts.abs.svg}</div>` : ''}
<h2 style="break-before: page">Détail journalier</h2>
<table><thead><tr><th>Date</th><th>Arrivée</th><th>Départ</th><th>Pauses</th><th class="num">Travaillé</th><th class="num">Attendu</th><th class="num">Écart</th><th>Absence / férié</th></tr></thead><tbody>
${list.map((r) => `<tr><td class="${r.we ? 'we' : ''}">${r.date.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', year: '2-digit' })}</td><td>${r.first ? fmtTime(r.first) : ''}</td><td>${r.last ? fmtTime(r.last) : ''}</td><td>${esc(r.pausesTxt)}</td><td class="num">${r.work ? fmtDur(r.work) : ''}</td><td class="num">${r.expected ? fmtDur(r.expected) : ''}</td><td class="num ${r.delta >= 0 ? 'pos' : 'neg'}">${r.delta != null && (r.work || r.expected) ? fmtDur(r.delta, { sign: true }) : ''}</td><td>${esc(r.absTxt)}</td></tr>`).join('')}
<tr><td><b>Total</b></td><td></td><td></td><td></td><td class="num"><b>${fmtDur(k.total)}</b></td><td class="num"><b>${fmtDur(k.expected)}</b></td><td class="num ${k.balance >= 0 ? 'pos' : 'neg'}"><b>${fmtDur(k.balance, { sign: true })}</b></td><td></td></tr>
</tbody></table></body></html>`;
  const w = window.open('', '_blank');
  if (!w) { downloadBlob(`Rapport_${stamp(start, end)}.html`, new Blob([html], { type: 'text/html' })); return; }
  w.document.open(); w.document.write(html); w.document.close();
  return html;
}
