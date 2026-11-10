// Vue « Statistiques » : tableau de bord enrichi.
import { $, $$, esc, fmtDur, fmtHM, fmtNum, parseDay, dayKey, monthKey, HOUR, MIN, equivalence, pad, startOfMonth, endOfMonth } from '../util.js';
import { ABSENCE_TYPES, absColor, FERIE_COLOR } from '../calc.js';
import * as store from '../store.js';
import { mount, mountHeatmap } from '../charts.js';
import { openDay } from '../dialogs.js';

export const meta = { title: 'Statistiques', sub: 'Analysez votre temps de travail' };

const now0 = new Date();
let period = { preset: 'year', start: `${now0.getFullYear()}-01`, end: `${now0.getFullYear()}-12` };
let distType = 'arrivee';

const PRESETS = [
  ['month', 'Ce mois'], ['3m', '3 mois'], ['year', 'Cette année'], ['12m', '12 mois'], ['prev', 'Année dernière'], ['all', 'Tout'],
];
function applyPreset(p) {
  const n = new Date(), y = n.getFullYear(), m = n.getMonth();
  const mk = (d) => monthKey(d);
  if (p === 'month') period = { preset: p, start: mk(n), end: mk(n) };
  if (p === '3m') period = { preset: p, start: mk(new Date(y, m - 2, 1)), end: mk(n) };
  if (p === 'year') period = { preset: p, start: `${y}-01`, end: `${y}-12` };
  if (p === '12m') period = { preset: p, start: mk(new Date(y, m - 11, 1)), end: mk(n) };
  if (p === 'prev') period = { preset: p, start: `${y - 1}-01`, end: `${y - 1}-12` };
  if (p === 'all') {
    const first = store.state.pointages[0];
    period = { preset: p, start: first ? mk(new Date(first._t)) : `${y}-01`, end: mk(n) };
  }
}

const fmtH = (v) => fmtHM(v);
const fmtHours = (v) => `${fmtNum(v, 0)} h`;
const delta = (cur, prev, fmt, invert = false) => {
  if (prev == null || cur == null) return '';
  const d = cur - prev; if (!d) return '';
  const good = invert ? d < 0 : d > 0;
  return `<span class="badge ${good ? 'pos' : 'neg'}" title="vs même période N-1">${d > 0 ? '▲' : '▼'} ${fmt(Math.abs(d))}</span>`;
};

export function render(el) {
  const e = store.engine(), now = Date.now();
  const start = parseDay(`${period.start}-01`), end = endOfMonth(parseDay(`${period.end}-01`));
  if (end < start) { period.end = period.start; return render(el); }
  const st = e.stats(start, end, now);
  const prevStart = new Date(start.getFullYear() - 1, start.getMonth(), 1), prevEnd = new Date(end.getFullYear() - 1, end.getMonth() + 1, 0);
  const pv = e.stats(prevStart, prevEnd, now);
  const hasPrev = pv.kpi.workedDays > 0;
  const k = st.kpi, p = hasPrev ? pv.kpi : {};
  const hpdH = e.hpdMs(dayKey(new Date())) / HOUR;

  el.innerHTML = `
  <div class="card" style="margin-bottom:16px">
    <div class="row wrap between">
      <div class="seg" id="presets">${PRESETS.map(([v, l]) => `<button data-v="${v}" aria-pressed="${period.preset === v}">${l}</button>`).join('')}</div>
      <div class="row">
        <input class="input sm" type="month" id="st-start" value="${period.start}" style="width:150px" aria-label="Début">
        <span class="muted">→</span>
        <input class="input sm" type="month" id="st-end" value="${period.end}" style="width:150px" aria-label="Fin">
      </div>
    </div>
  </div>

  <div class="grid g4">
    <div class="kpi accent"><div class="k">Temps travaillé</div><div class="v">${fmtDur(k.total)}</div><div class="s">${k.workedDays} jours ${delta(k.total / HOUR, hasPrev ? p.total / HOUR : null, fmtHours)}</div></div>
    <div class="kpi"><div class="k">Moyenne par jour travaillé</div><div class="v">${fmtDur(k.avgDay)}</div><div class="s">attendu ${fmtDur(hpdH * HOUR)} ${delta(k.avgDay / MIN, hasPrev ? p.avgDay / MIN : null, (v) => `${Math.round(v)} min`)}</div></div>
    <div class="kpi"><div class="k">Solde de la période</div><div class="v ${k.balance >= 0 ? 'pos' : 'neg'}">${fmtDur(k.balance, { sign: true })}</div><div class="s">${equivalence(k.balance / HOUR, hpdH) || `sur ${fmtDur(k.expected)} attendues`}</div></div>
    <div class="kpi"><div class="k">Journée la plus longue</div><div class="v">${k.longest ? fmtDur(k.longest.ms) : '--'}</div><div class="s">${k.longest ? parseDay(k.longest.key).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : ''}</div></div>
    <div class="kpi"><div class="k">Arrivée (médiane)</div><div class="v">${fmtH(k.medArrival)}</div><div class="s">plus tôt ${fmtH(k.earliest)} ${delta(k.medArrival, hasPrev ? p.medArrival : null, (v) => `${Math.round(v * 60)} min`, true)}</div></div>
    <div class="kpi"><div class="k">Départ (médiane)</div><div class="v">${fmtH(k.medDeparture)}</div><div class="s">plus tard ${fmtH(k.latest)} ${delta(k.medDeparture, hasPrev ? p.medDeparture : null, (v) => `${Math.round(v * 60)} min`, true)}</div></div>
    <div class="kpi"><div class="k">Pause moyenne / jour</div><div class="v">${Math.round(k.avgPauseDay / MIN)} min</div><div class="s">${k.nbPauses} pauses au total</div></div>
    <div class="kpi"><div class="k">Amplitude moyenne</div><div class="v">${fmtDur(k.avgAmplitude)}</div><div class="s">de l'arrivée au départ</div></div>
  </div>

  <div class="grid g2" style="margin-top:16px">
    <div class="card span2"><div class="card-head"><div><div class="card-title">Heures travaillées et heures attendues</div><div class="card-sub" id="vol-sub"></div></div></div><div class="chart" id="ch-volume"></div></div>
    <div class="card"><div class="card-head"><div><div class="card-title">Solde cumulé</div><div class="card-sub">Heures sup. (+) ou manquantes (−) au fil de la période</div></div></div><div class="chart" id="ch-cumul"></div></div>
    <div class="card"><div class="card-head"><div><div class="card-title">Moyenne par jour de la semaine</div><div class="card-sub">Jours travaillés uniquement</div></div></div><div class="chart" id="ch-weekday"></div></div>
    <div class="card span2"><div class="card-head"><div><div class="card-title">Rythme journalier</div><div class="card-sub">Heures moyennes par mois</div></div></div><div class="chart" id="ch-rythme"></div></div>
    <div class="card span2">
      <div class="card-head"><div><div class="card-title">Répartition des horaires</div><div class="card-sub">Fréquence et dispersion mois par mois</div></div>
        <select class="select sm" id="dist-type" style="width:auto">
          ${[['arrivee', "Heure d'arrivée"], ['depart', 'Heure de départ'], ['pause_debut', 'Début des pauses'], ['pause_fin', 'Fin des pauses'], ['duree_travail', 'Durée de la journée']].map(([v, l]) => `<option value="${v}" ${v === distType ? 'selected' : ''}>${l}</option>`).join('')}
        </select></div>
      <div class="grid g2"><div class="chart" id="ch-dist"></div><div class="chart" id="ch-box"></div></div>
    </div>
    <div class="card span2"><div class="card-head"><div><div class="card-title">Calendrier d'activité</div><div class="card-sub">Cliquez sur un jour pour l'ouvrir</div></div>
      <div class="legend" style="margin:0"><span><i class="dot-c" style="background:#ccfbf1"></i>&lt; 4 h</span><span><i class="dot-c" style="background:#5eead4"></i>&lt; 7 h</span><span><i class="dot-c" style="background:#14b8a6"></i>&lt; 8 h 30</span><span><i class="dot-c" style="background:#0f766e"></i>&lt; 10 h</span><span><i class="dot-c" style="background:#ef4444"></i>&gt; 10 h</span></div></div>
      <div class="heatmap" id="ch-heat"></div></div>
    <div class="card"><div class="card-head"><div><div class="card-title">Absences et jours fériés</div><div class="card-sub">En jours ouvrés</div></div></div><div class="chart" id="ch-abs"></div><div class="row wrap small" style="gap:6px 14px;margin-top:6px">${absTotalsHtml(st)}</div></div>
    <div class="card"><div class="card-head"><div><div class="card-title">Repères réglementaires</div><div class="card-sub">Garanties minimales (Code du travail / fonction publique)</div></div></div>${complianceHtml(st)}</div>
  </div>`;

  // Filtres
  $$('#presets button', el).forEach((b) => b.addEventListener('click', () => { applyPreset(b.dataset.v); render(el); }));
  const onRange = () => { period = { preset: 'custom', start: $('#st-start', el).value || period.start, end: $('#st-end', el).value || period.end }; render(el); };
  $('#st-start', el).addEventListener('change', onRange);
  $('#st-end', el).addEventListener('change', onRange);
  $('#dist-type', el).addEventListener('change', (ev) => { distType = ev.target.value; drawDist(el, st); });
  el.querySelectorAll('[data-open-day]').forEach((a) => a.addEventListener('click', (ev) => { ev.preventDefault(); openDay(a.dataset.openDay); }));

  drawVolume(el, st);
  const step = Math.max(1, Math.ceil(st.cumul.length / 120));
  const cum = st.cumul.filter((_, i) => i % step === 0 || i === st.cumul.length - 1);
  const last = cum[cum.length - 1]?.value ?? 0;
  mount($('#ch-cumul', el), 'line', {
    labels: cum.map((c) => parseDay(c.key).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })),
    series: [{ name: 'Solde', color: last >= 0 ? '#10b981' : '#ef4444', values: cum.map((c) => c.value), area: true, dots: false }],
    yFormat: (v) => fmtHM(v), includeZero: true, height: 240,
  });
  const wd = st.weekday.filter((w) => w.n > 0 || (w.day >= 1 && w.day <= 5));
  mount($('#ch-weekday', el), 'bar', {
    labels: wd.map((w) => ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'][w.day]),
    series: [{ name: 'Moyenne', color: '#6366f1', values: wd.map((w) => w.avg / HOUR) }],
    lines: [{ name: 'Attendu', color: '#94a3b8', dash: '5 4', values: wd.map(() => hpdH) }],
    yFormat: (v) => fmtHM(v), height: 240,
  });
  const ms = st.months;
  mount($('#ch-rythme', el), 'line', {
    labels: ms.map((m) => m.label),
    series: [
      { name: 'Arrivée', color: '#14b8a6', values: ms.map((m) => m.arrAvg) },
      { name: 'Début pause', color: '#f59e0b', values: ms.map((m) => m.psAvg), dash: '5 4' },
      { name: 'Fin pause', color: '#ea580c', values: ms.map((m) => m.peAvg), dash: '5 4' },
      { name: 'Départ', color: '#6366f1', values: ms.map((m) => m.depAvg) },
    ],
    yFormat: (v) => fmtHM(v), pad: true, height: 280,
  });
  drawDist(el, st);
  drawHeat(el, st, e);
  const types = [...Object.keys(ABSENCE_TYPES), ...Object.keys(st.absTotals).filter((t) => !ABSENCE_TYPES[t])];
  mount($('#ch-abs', el), 'bar', {
    labels: ms.map((m) => m.label), stacked: true,
    series: [...types.map((t) => ({ name: t, color: absColor(t), values: ms.map((m) => m.abs[t] || 0) })), { name: 'Fériés', color: FERIE_COLOR, values: ms.map((m) => m.feries) }]
      .filter((s) => s.values.some((v) => v)),
    yFormat: (v) => `${fmtNum(v)} j`, height: 240,
  });
}

function drawVolume(el, st) {
  const byWeek = st.months.length <= 3;
  const rows = byWeek ? st.weeks : st.months;
  $('#vol-sub', el).textContent = byWeek ? 'Par semaine' : 'Par mois';
  mount($('#ch-volume', el), 'bar', {
    labels: rows.map((r) => r.label),
    series: [{ name: 'Travaillé (+ formation)', color: (v, i) => (rows[i].real >= rows[i].expected && rows[i].expected ? '#10b981' : '#14b8a6'), values: rows.map((r) => r.real / HOUR) }],
    lines: [{ name: 'Attendu', color: '#64748b', dash: '6 4', values: rows.map((r) => (r.expected ? r.expected / HOUR : null)) }],
    yFormat: (v) => `${Math.round(v)} h`, tipFormat: (v) => fmtHM(v), height: 280,
  });
}

function drawDist(el, st) {
  const data = st.dist[distType] || [];
  const isDur = distType === 'duree_travail';
  const colors = { arrivee: '#14b8a6', depart: '#6366f1', pause_debut: '#f59e0b', pause_fin: '#ea580c', duree_travail: '#8b5cf6' };
  const binMin = isDur ? 15 : 10;
  let labels = [], counts = [];
  if (data.length) {
    const vals = data.map((d) => Math.round(d.v * 60));
    const lo = Math.floor(Math.min(...vals) / binMin) * binMin, hi = Math.floor(Math.max(...vals) / binMin) * binMin;
    for (let b = lo; b <= hi && labels.length < 200; b += binMin) { labels.push(`${Math.floor(b / 60)}h${pad(b % 60)}`); counts.push(0); }
    vals.forEach((v) => { const i = Math.floor((Math.floor(v / binMin) * binMin - lo) / binMin); if (counts[i] != null) counts[i]++; });
  }
  mount($('#ch-dist', el), 'bar', {
    labels, series: [{ name: isDur ? 'Jours' : 'Occurrences', color: colors[distType], values: counts }],
    yFormat: (v) => String(Math.round(v)), height: 260,
  });
  const months = st.months.map((m) => m.key);
  mount($('#ch-box', el), 'box', {
    labels: st.months.map((m) => m.label), groups: months.map((k) => data.filter((d) => d.m === k).map((d) => d.v)),
    color: colors[distType], yFormat: (v) => fmtHM(v), height: 260,
  });
}

const HEAT = ['#ccfbf1', '#5eead4', '#14b8a6', '#0f766e'];
function drawHeat(el, st, e) {
  let start = st.start;
  const end = st.end;
  if ((end - start) / 86400000 > 370) start = new Date(end.getFullYear() - 1, end.getMonth() + 1, 1);
  const byKey = new Map(st.days.map((d) => [d.key, d]));
  mountHeatmap($('#ch-heat', el), {
    start, end,
    cell: (key) => {
      const d = byKey.get(key);
      const title = parseDay(key).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      if (!d) return { key, title, rows: [] };
      const h = d.work / HOUR;
      let color = null;
      if (h > 10) color = '#ef4444'; else if (h >= 8.5) color = HEAT[3]; else if (h >= 7) color = HEAT[2]; else if (h >= 4) color = HEAT[1]; else if (h > 0) color = HEAT[0];
      else if (d.abs.length && !d.we && !d.ferie) color = `${absColor(d.abs[0].type_absence)}88`;
      else if (d.ferie && !d.we) color = `${FERIE_COLOR}88`;
      const rows = [];
      if (d.work) rows.push({ name: 'Travaillé', value: fmtDur(d.work), raw: true, color: color || undefined });
      if (d.ferie) rows.push({ name: d.ferie, value: '', raw: true, color: FERIE_COLOR });
      d.abs.forEach((a) => rows.push({ name: a.type_absence, value: a.moment === 'journee' ? 'journée' : a.moment === 'matin' ? 'matin' : 'après-midi', raw: true, color: absColor(a.type_absence) }));
      return { key, title, rows, color };
    },
    onClick: (key) => openDay(key),
  });
}

function absTotalsHtml(st) {
  const items = Object.entries(st.absTotals).sort((a, b) => b[1] - a[1]).map(([t, n]) => `<span><i class="dot-c" style="background:${absColor(t)}"></i>${esc(t)} <b>${fmtNum(n)}</b> j</span>`);
  if (st.feriesCount) items.push(`<span><i class="dot-c" style="background:${FERIE_COLOR}"></i>Fériés <b>${st.feriesCount}</b> j</span>`);
  return items.join('') || '<span class="muted">Aucune absence sur la période.</span>';
}

function complianceHtml(st) {
  const c = st.compliance;
  const dl = (k) => `<a href="#" data-open-day="${k}">${parseDay(k).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })}</a>`;
  const item = (label, list, fmt) => `<div><div class="item ${list.length ? 'ko' : 'ok'}"><span>${label}</span><span class="n">${list.length}</span></div>${list.length ? `<details><summary>Voir les dates</summary>${list.slice(0, 60).map(fmt).join(', ')}${list.length > 60 ? '…' : ''}</details>` : ''}</div>`;
  return `<div class="compliance">
    ${item('Journées de plus de 10 h', c.over10, (k) => dl(k))}
    ${item('Semaines de plus de 48 h', c.over48, (w) => `${w.label} (${fmtDur(w.ms)})`)}
    ${item('Repos quotidien de moins de 11 h', c.shortRest, (r) => `${dl(r.key)} (${fmtDur(r.ms)})`)}
    ${item('Pause < 20 min après 6 h de travail', c.shortPause, (k) => dl(k))}
  </div>`;
}
export { startOfMonth };
