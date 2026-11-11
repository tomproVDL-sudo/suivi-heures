// Vue « Planning » : soldes (compteurs personnalisables) + calendrier mois/semaine.
import { $, esc, fmtDur, fmtDays, fmtTime, dayKey, todayKey, parseDay, startOfWeek, startOfMonth, addDays, HOUR, capitalize } from '../util.js';
import { ABSENCE_TYPES, absColor, FERIE_COLOR, isHalf } from '../calc.js';
import * as store from '../store.js';
import { icon } from '../icons.js';
import { openDay, openAbsence } from '../dialogs.js';
import { openDialog } from '../ui.js';

let root, cursor = new Date(), mode = 'month', editing = false;

export const meta = {
  title: 'Planning',
  sub: () => 'Soldes, absences et heures jour par jour',
  actions: () => `<button class="btn btn-primary" id="act-absence">${icon('plus')} Déclarer une absence</button>`,
  bind: () => $('#act-absence').addEventListener('click', () => openAbsence()),
};

const fmtShort = (k) => parseDay(k).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
const COUNTERS = {
  1607: { label: 'Objectif annuel', c: '#64748b', v: (s, o) => (o.atteint ? 'Atteint' : `${Math.round(o.reste / HOUR)} h`), s: (s, o) => (o.atteint ? `le ${fmtShort(o.atteint)}` : `restantes sur ${Math.round(o.objectif / HOUR)} h`) },
  reliquat: { label: 'Reliquat CP N-1', c: '#94a3b8', v: (s) => fmtDays(s.reliquatRestant), s: (s, o, p) => (p.date_limite_reliquat ? (s.reliquatExpire ? 'Expiré' : `avant le ${fmtShort(p.date_limite_reliquat)}`) : '') },
  cp: { label: 'Congés payés restants', c: ABSENCE_TYPES.CP.color, v: (s) => fmtDays(s.cpRestants), s: (s, o, p) => `${fmtDays(s.cons.CP)} pris sur ${p.cp_initial}` },
  rtt: { label: 'RTT restants', c: ABSENCE_TYPES.RTT.color, v: (s) => fmtDays(s.rttRestants), s: (s, o, p) => `${fmtDays(s.cons.RTT)} pris sur ${p.rtt_initial}`, flag: (s) => (s.rttAlerte ? 'À poser !' : '') },
  cet: { label: 'CET', c: ABSENCE_TYPES.CET.color, v: (s) => fmtDays(s.cetRestants), s: (s) => (s.cons.CET ? `${fmtDays(s.cons.CET)} utilisés` : '') },
  fractionnement: { label: 'Fractionnement', c: '#ec4899', v: (s) => `+${s.jFrac} j`, s: (s) => `${fmtDays(s.fractionnement)} de CP hors mai-oct.` },
  ponts: { label: 'Ponts posés', c: '#10b981', v: (s) => `${s.pontsPoses} / ${s.pontsPossibles}`, s: () => 'ponts de 1 jour cette année' },
  recup: { label: 'Heures à récupérer', c: '#f59e0b', v: (s) => `${s.recup} h`, s: () => '' },
  aea: { label: 'Autorisations except.', c: ABSENCE_TYPES.AEA.color, v: (s) => fmtDays(s.cons.AEA), s: () => 'posées cette année' },
  formation: { label: 'Formation', c: ABSENCE_TYPES.Formation.color, v: (s) => fmtDays(s.cons.Formation), s: () => 'cette année' },
  maladie: { label: 'Arrêt maladie', c: ABSENCE_TYPES.Maladie.color, v: (s) => fmtDays(s.cons.Maladie), s: () => 'jours ouvrés cette année' },
  don: { label: 'Don de jours', c: '#f43f5e', v: (s) => `${s.don > 0 ? '+' : ''}${s.don} j`, s: () => '' },
};
const DEFAULT_ORDER = ['1607', 'reliquat', 'cp', 'rtt', 'cet', 'fractionnement', 'ponts', 'recup', 'aea', 'formation', 'maladie', 'don'];

function order() {
  const saved = (store.state.prefs.counterOrder || []).filter((id) => COUNTERS[id]);
  return [...saved, ...DEFAULT_ORDER.filter((id) => !saved.includes(id))];
}
const hidden = () => store.state.prefs.hiddenCounters || [];

export function render(el) {
  root = el;
  const e = store.engine(), now = Date.now();
  const ot = e.overtime(now);
  root.innerHTML = `
    <div class="hs-strip">
      ${hs('Heures sup. semaine', ot.week)}${hs('Heures sup. mois', ot.month)}${hs('Heures sup. année', ot.year)}
    </div>
    <div class="row between" style="margin:20px 0 10px">
      <div class="section-title" style="margin:0">Mes soldes ${new Date().getFullYear()}</div>
      <div class="row">
        <button class="btn btn-sm btn-ghost" id="cnt-hidden" ${editing ? '' : 'hidden'}>${icon('plus')} Compteurs masqués</button>
        <button class="btn btn-sm${editing ? ' btn-primary' : ''}" id="cnt-edit">${editing ? `${icon('check')} Terminer` : `${icon('layout')} Personnaliser`}</button>
      </div>
    </div>
    <div class="counters${editing ? ' editing' : ''}" id="counters"></div>
    <div class="card" style="margin-top:18px">
      <div class="cal-toolbar">
        <div class="row">
          <button class="btn icon-btn" id="cal-prev" aria-label="Précédent">${icon('left')}</button>
          <button class="btn btn-sm" id="cal-today">Aujourd'hui</button>
          <button class="btn icon-btn" id="cal-next" aria-label="Suivant">${icon('right')}</button>
          <div class="cal-title" id="cal-title"></div>
        </div>
        <div class="seg" id="cal-mode">
          <button data-v="month" aria-pressed="${mode === 'month'}">Mois</button>
          <button data-v="week" aria-pressed="${mode === 'week'}">Semaine</button>
        </div>
      </div>
      <div id="cal" class="swipe-zone"></div>
      <div class="xs faint swipe-hint">Balayez vers la gauche ou la droite pour changer de période</div>
      <div class="cal-legend">
        <span><i class="dot-c" style="background:#3b82f6"></i>Sous l'objectif</span>
        <span><i class="dot-c" style="background:#10b981"></i>Objectif atteint</span>
        <span><i class="dot-c" style="background:#f97316"></i>≥ ${fmtDur(e.prefs.seuilOrangeMin * 60000)}</span>
        <span><i class="dot-c" style="background:#ef4444"></i>&gt; ${fmtDur(e.prefs.seuilRougeMin * 60000)}</span>
        <span style="margin-left:auto"></span>
        ${Object.entries(ABSENCE_TYPES).map(([k, v]) => `<span><i class="dot-c" style="background:${v.color}"></i>${k}</span>`).join('')}
        <span><i class="dot-c" style="background:${FERIE_COLOR}"></i>Férié</span>
      </div>
    </div>`;
  renderCounters(e, now);
  renderCal(e, now);
  enableSwipe($('#cal', root));
  $('#cal-prev', root).onclick = () => { shift(-1); };
  $('#cal-next', root).onclick = () => { shift(1); };
  $('#cal-today', root).onclick = () => { cursor = new Date(); renderCal(store.engine(), Date.now()); };
  root.querySelectorAll('#cal-mode button').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.v; root.querySelectorAll('#cal-mode button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderCal(store.engine(), Date.now());
  }));
  $('#cnt-edit', root).onclick = () => { editing = !editing; render(root); };
  $('#cnt-hidden', root).onclick = openHidden;
}

function hs(label, r) {
  return `<div class="kpi"><div class="k">${label}</div><div class="v ${r.delta >= 0 ? 'pos' : 'neg'}">${fmtDur(r.delta, { sign: true })}</div><div class="s">${fmtDur(r.real)} / ${fmtDur(r.expected)}</div></div>`;
}

function shift(n) {
  if (mode === 'month') cursor = new Date(cursor.getFullYear(), cursor.getMonth() + n, 1);
  else cursor = addDays(cursor, 7 * n);
  renderCal(store.engine(), Date.now());
  const cal = $('#cal', root);
  if (cal) { cal.classList.remove('slide-next', 'slide-prev'); void cal.offsetWidth; cal.classList.add(n > 0 ? 'slide-next' : 'slide-prev'); }
}

/** Balayage gauche / droite (doigt ou souris) pour changer de mois / semaine. */
function enableSwipe(cal) {
  let x0 = null, y0 = 0, t0 = 0, swiped = false;
  cal.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && e.button !== 0) return; x0 = e.clientX; y0 = e.clientY; t0 = Date.now(); swiped = false; });
  cal.addEventListener('pointermove', (e) => {
    if (x0 == null || e.pointerType === 'mouse') return;
    const dx = e.clientX - x0;
    if (Math.abs(dx) > Math.abs(e.clientY - y0)) cal.style.transform = `translateX(${dx * 0.25}px)`;
  });
  const end = (e) => {
    if (x0 == null) return;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    cal.style.transform = '';
    x0 = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - t0 < 800) { swiped = true; shift(dx < 0 ? 1 : -1); }
  };
  cal.addEventListener('pointerup', end);
  cal.addEventListener('pointercancel', () => { x0 = null; cal.style.transform = ''; });
  // Un balayage ne doit pas ouvrir le jour sous le doigt
  cal.addEventListener('click', (e) => { if (swiped) { e.stopPropagation(); e.preventDefault(); swiped = false; } }, true);
}

// ---------- Compteurs ----------
function renderCounters(e, now) {
  const s = e.soldes(new Date(now).getFullYear(), now), o = e.objectif(now), p = e.params;
  const box = $('#counters', root);
  box.innerHTML = order().filter((id) => !hidden().includes(id)).map((id) => {
    const c = COUNTERS[id], flag = c.flag?.(s) || '';
    return `<div class="counter" data-id="${id}" style="--c:${c.c}">
      <button class="hide-btn" data-hide="${id}" aria-label="Masquer">×</button>
      ${flag ? `<div class="flag">${flag}</div>` : ''}
      <div class="k">${c.label}</div><div class="v">${c.v(s, o, p)}</div><div class="s">${esc(c.s(s, o, p))}</div></div>`;
  }).join('');
  box.querySelectorAll('[data-hide]').forEach((b) => b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    store.savePrefs({ hiddenCounters: [...hidden(), b.dataset.hide] });
    renderCounters(store.engine(), Date.now());
  }));
  enableDrag(box);
}

function enableDrag(box) {
  let drag = null;
  box.onpointerdown = (ev) => {
    if (!editing || ev.target.closest('.hide-btn')) return;
    const card = ev.target.closest('.counter'); if (!card) return;
    drag = card; card.classList.add('dragging'); card.setPointerCapture(ev.pointerId); ev.preventDefault();
  };
  box.onpointermove = (ev) => {
    if (!drag) return;
    const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.counter');
    if (!over || over === drag || over.parentElement !== box) return;
    const r = over.getBoundingClientRect();
    box.insertBefore(drag, ev.clientX > r.left + r.width / 2 ? over.nextSibling : over);
  };
  const end = () => {
    if (!drag) return;
    drag.classList.remove('dragging'); drag = null;
    const visible = [...box.children].map((c) => c.dataset.id);
    store.savePrefs({ counterOrder: [...visible, ...order().filter((id) => !visible.includes(id))] });
  };
  box.onpointerup = end; box.onpointercancel = end;
}

function openHidden() {
  const list = $('#hidden-counters');
  const h = hidden();
  list.innerHTML = h.length ? h.map((id) => `<div class="list-item"><div class="main"><div>${COUNTERS[id]?.label || id}</div></div><button class="btn btn-sm" data-show="${id}">${icon('plus')} Afficher</button></div>`).join('')
    : '<div class="empty">Tous les compteurs sont affichés.</div>';
  list.querySelectorAll('[data-show]').forEach((b) => b.addEventListener('click', () => {
    store.savePrefs({ hiddenCounters: hidden().filter((x) => x !== b.dataset.show) });
    b.closest('.list-item').remove();
    if (root?.isConnected) renderCounters(store.engine(), Date.now());
  }));
  openDialog('#dlg-counters');
}

// ---------- Calendrier ----------
function renderCal(e, now) {
  if (mode === 'month') renderMonth(e, now); else renderWeek(e, now);
}

function chipsFor(plan, max = 2) {
  const out = [];
  if (plan.ferie) out.push(`<div class="chip ferie" title="${esc(plan.ferie)}">${esc(plan.ferie)}</div>`);
  for (const a of plan.abs) {
    out.push(`<div class="chip" style="--c:${absColor(a.type_absence)}" data-edit-absence="${esc(a.id)}" title="${esc(a.type_absence)}">${esc(a.type_absence)}${isHalf(a) ? (a.moment === 'matin' ? ' (mat.)' : ' (ap-m)') : ''}</div>`);
  }
  if (out.length > max) return [...out.slice(0, max - 1), `<div class="chip ferie">+${out.length - max + 1}</div>`].join('');
  return out.join('');
}

function bubble(e, k, work) {
  if (!work) return '';
  const h = work / HOUR, size = Math.round(Math.min(48, Math.max(30, h * 5)));
  return `<div class="bubble lv-${e.dayLevel(work, k)}" style="width:${size}px;height:${size}px"><span>${fmtDur(work).replace('h00', 'h')}</span></div>`;
}

function renderMonth(e, now) {
  const first = startOfMonth(cursor), start = startOfWeek(first);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const weeks = Math.ceil(((first.getDay() + 6) % 7 + days) / 7);
  $('#cal-title', root).textContent = first.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const tk = todayKey();
  let cells = '';
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i), k = dayKey(d);
    const s = e.summary(k, now), plan = e.dayPlan(k);
    const cls = ['cal-cell', d.getMonth() !== first.getMonth() && 'out', plan.we && 'we', k === tk && 'today'].filter(Boolean).join(' ');
    cells += `<div class="${cls}" data-day="${k}" title="${s.work ? `Travaillé ${fmtDur(s.work)}` : ''}"><div class="dnum">${d.getDate()}</div>${bubble(e, k, s.work)}<div class="cal-chips">${chipsFor(plan)}</div></div>`;
  }
  const cal = $('#cal', root);
  cal.innerHTML = `<div class="cal"><div class="cal-dow">${['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'].map((x) => `<div>${x}</div>`).join('')}</div><div class="cal-grid">${cells}</div></div>`;
  cal.querySelectorAll('[data-day]').forEach((c) => c.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-edit-absence]')) return;
    openDay(c.dataset.day);
  }));
}

function renderWeek(e, now) {
  const start = startOfWeek(cursor), end = addDays(start, 6);
  $('#cal-title', root).textContent = `${start.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const tk = todayKey();
  const cols = [];
  let hMin = 7, hMax = 19;
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i), k = dayKey(d), s = e.summary(k, now);
    for (const g of s.segments) { hMin = Math.min(hMin, new Date(g.s).getHours()); hMax = Math.max(hMax, new Date(g.e).getHours() + 1); }
    cols.push({ d, k, s, plan: e.dayPlan(k) });
  }
  hMax = Math.min(24, hMax);
  const PX = 34, H = (hMax - hMin) * PX;
  const y = (t) => { const x = new Date(t); return ((x.getHours() + x.getMinutes() / 60) - hMin) * PX; };
  const absRange = { journee: [8.5, 17.5], matin: [8.5, 12], aprem: [13.5, 17.5] };
  let html = '<div class="wk"><div class="wk-head"></div>';
  for (const c of cols) html += `<div class="wk-head${c.k === tk ? ' today' : ''}" data-day="${c.k}">${c.d.toLocaleDateString('fr-FR', { weekday: 'short' })}<b>${c.d.getDate()}</b><div class="tot">${c.s.work ? fmtDur(c.s.work) : '&nbsp;'}</div></div>`;
  html += `<div class="wk-axis" style="height:${H}px">${Array.from({ length: hMax - hMin + 1 }, (_, i) => `<div style="top:${i * PX}px">${hMin + i}h</div>`).join('')}</div>`;
  for (const c of cols) {
    let blocks = '';
    for (const a of c.plan.abs) {
      const [h0, h1] = absRange[a.moment] || absRange.journee;
      blocks += `<div class="wk-blk a" style="--c:${absColor(a.type_absence)};top:${(h0 - hMin) * PX}px;height:${(h1 - h0) * PX}px" data-edit-absence="${esc(a.id)}">${esc(a.type_absence)}</div>`;
    }
    if (c.plan.ferie) blocks += `<div class="wk-blk a" style="--c:${FERIE_COLOR};top:${(8.5 - hMin) * PX}px;height:${9 * PX}px">${esc(c.plan.ferie)}</div>`;
    for (const g of c.s.segments) {
      const top = y(g.s), h = Math.max(3, y(g.e) - top);
      blocks += `<div class="wk-blk ${g.type === 'work' ? 'w' : 'p'}" style="top:${top}px;height:${h}px" title="${fmtTime(g.s)}–${fmtTime(g.e)}">${h > 26 ? `${fmtTime(g.s)}–${fmtTime(g.e)}` : ''}</div>`;
    }
    html += `<div class="wk-col${c.plan.we ? ' we' : ''}" data-day="${c.k}" style="height:${H}px;background-size:100% ${PX}px">${blocks}</div>`;
  }
  html += '</div>';
  const cal = $('#cal', root);
  cal.innerHTML = html;
  cal.querySelectorAll('[data-day]').forEach((c) => c.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-edit-absence]')) return;
    openDay(c.dataset.day);
  }));
}

/** Rafraîchit la bulle du jour chaque minute. */
export function tick() {
  if (root?.isConnected && mode === 'month' && !editing) renderCal(store.engine(), Date.now());
}
export { capitalize };
