// Dialogues : détail d'une journée, édition d'un pointage, saisie d'une absence.
import { $, $$, esc, fmtDur, fmtTime, parseDay, dayKey, todayKey, capitalize } from './util.js';
import { ABSENCE_TYPES, absColor, momentLabel } from './calc.js';
import * as store from './store.js';
import { icon } from './icons.js';
import { toast, openDialog, closeDialog, errMsg, busy } from './ui.js';

export const ACTIONS = {
  arrivee: { label: 'Arrivée / reprise', icon: 'play' },
  pause: { label: 'Début de pause', icon: 'coffee' },
  depart: { label: 'Départ', icon: 'stop' },
};

export function eventRow(p, extra = '') {
  const a = ACTIONS[p.type_action] || { label: p.type_action, icon: 'clock' };
  const pending = store.isTmp(p.id);
  return `<div class="event${pending ? ' pending' : ''}">
    <div class="ico ${esc(p.type_action)}">${icon(a.icon)}</div>
    <div class="l">${a.label}${pending ? '<small>En attente de synchronisation</small>' : extra}</div>
    <div class="t">${fmtTime(p._t)}</div>
    <button class="btn btn-ghost icon-btn sm" data-edit-pointage="${esc(p.id)}" aria-label="Modifier">${icon('edit')}</button>
  </div>`;
}

// Délégation : tout bouton [data-edit-pointage] ouvre l'édition
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-edit-pointage]');
  if (b) openPointage(b.dataset.editPointage);
  const c = e.target.closest('[data-edit-absence]');
  if (c) { e.stopPropagation(); const a = store.state.absences.find((x) => String(x.id) === c.dataset.editAbsence); if (a) openAbsence(a); }
});

// ---------- Journée ----------
let openKey = null;
export function openDay(key) {
  openKey = key;
  $('#day-add-time').value = '';
  openDialog('#dlg-day');
  renderDay();
}
export function renderDay() {
  if (!openKey || !$('#dlg-day').open) return;
  const e = store.engine(), key = openKey;
  const s = e.summary(key), plan = e.dayPlan(key);
  $('#day-title').textContent = capitalize(parseDay(key).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
  const real = s.work + plan.credit, delta = real - plan.expected;
  $('#day-summary').innerHTML = `
    <div><div class="k">Travaillé</div><div class="v">${fmtDur(real)}</div></div>
    <div><div class="k">Pauses</div><div class="v">${fmtDur(s.pause)}</div></div>
    <div><div class="k">Écart (attendu ${fmtDur(plan.expected)})</div><div class="v ${delta >= 0 ? 'pos' : 'neg'}">${s.n || plan.credit || key < todayKey() ? fmtDur(delta, { sign: true }) : '--'}</div></div>`;
  const chips = [];
  if (plan.ferie) chips.push(`<span class="chip ferie">${esc(plan.ferie)}</span>`);
  for (const a of plan.abs) chips.push(`<span class="chip" style="--c:${absColor(a.type_absence)}" data-edit-absence="${esc(a.id)}">${esc(a.type_absence)} · ${momentLabel(a.moment)}</span>`);
  $('#day-absences').innerHTML = chips.length ? `<div class="row wrap">${chips.join('')}</div>` : '';
  const pts = e.points(key);
  $('#day-events').innerHTML = pts.length ? pts.map((p) => eventRow(p)).join('') : '<div class="empty">Aucun pointage ce jour.</div>';
}
store.onChange(() => renderDay());

$('#day-add').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const t = $('#day-add-time').value; if (!t || !openKey) return;
  const [h, m] = t.split(':').map(Number);
  const d = parseDay(openKey); d.setHours(h, m, 0, 0);
  try {
    const r = await store.addPointage($('#day-add-type').value, d);
    $('#day-add-time').value = '';
    toast(r.offline ? 'Pointage enregistré hors-ligne' : 'Pointage ajouté');
  } catch (err) { toast(errMsg(err), { error: true }); }
});
$('#day-to-absence').addEventListener('click', () => {
  const k = openKey; closeDialog('#dlg-day');
  openAbsence({ date_debut: k, date_fin: k, moment: 'journee', type_absence: 'RTT' });
});

// ---------- Pointage ----------
let editId = null;
export function openPointage(id) {
  const p = store.state.pointages.find((x) => String(x.id) === String(id));
  if (!p) return;
  editId = p.id;
  const a = ACTIONS[p.type_action]?.label || p.type_action;
  $('#pointage-desc').textContent = `${a} — ${new Date(p._t).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}`;
  $('#pointage-time').value = fmtTime(p._t);
  openDialog('#dlg-pointage');
}
$('#pointage-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const p = store.state.pointages.find((x) => x.id === editId); if (!p) return;
  const [h, m] = $('#pointage-time').value.split(':').map(Number);
  const d = new Date(p._t); d.setHours(h, m, 0, 0);
  try { closeDialog('#dlg-pointage'); await store.updatePointage(p.id, d); toast('Horaire modifié'); } catch (err) { toast(errMsg(err), { error: true }); }
});
$('#pointage-delete').addEventListener('click', async () => {
  closeDialog('#dlg-pointage');
  try {
    const removed = await store.deletePointage(editId);
    toast('Pointage supprimé', { action: removed ? () => store.restorePointage(removed).catch((e) => toast(errMsg(e), { error: true })) : null });
  } catch (err) { toast(errMsg(err), { error: true }); }
});

// ---------- Absence ----------
let absId = null, absMoment = 'journee';
const typeSel = $('#abs-type');
function setMoment(m) {
  absMoment = m;
  $$('#abs-moment button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === m)));
  const end = $('#abs-end');
  if (m !== 'journee') { end.value = $('#abs-start').value; end.disabled = true; } else end.disabled = false;
  updateCount();
}
function updateCount() {
  const s = $('#abs-start').value, e = $('#abs-end').value || s;
  const out = $('#abs-count');
  if (!s) { out.textContent = ''; return; }
  if (e < s) { out.innerHTML = '<span class="neg">La date de fin est avant la date de début.</span>'; return; }
  const eng = store.engine();
  const n = eng.absenceDays({ date_debut: s, date_fin: e, moment: absMoment });
  const overlap = store.state.absences.some((a) => String(a.id) !== String(absId) && a.date_debut <= e && (a.date_fin || a.date_debut) >= s);
  out.innerHTML = `<b>${String(n).replace('.', ',')}</b> jour${n > 1 ? 's' : ''} ouvré${n > 1 ? 's' : ''} décompté${n > 1 ? 's' : ''} (week-ends et fériés exclus).${overlap ? ' <span class="badge warn">Chevauche une autre absence</span>' : ''}`;
}
$$('#abs-moment button').forEach((b) => b.addEventListener('click', () => setMoment(b.dataset.v)));
$('#abs-start').addEventListener('change', () => {
  const s = $('#abs-start').value, end = $('#abs-end');
  if (absMoment !== 'journee' || !end.value || end.value < s) end.value = s;
  updateCount();
});
$('#abs-end').addEventListener('change', updateCount);

export function openAbsence(a = {}) {
  absId = a.id ?? null;
  const types = Object.keys(ABSENCE_TYPES);
  if (a.type_absence && !types.includes(a.type_absence)) types.push(a.type_absence);
  typeSel.innerHTML = types.map((t) => `<option value="${esc(t)}">${esc(ABSENCE_TYPES[t]?.label || t)}</option>`).join('');
  typeSel.value = a.type_absence || 'RTT';
  const k = a.date_debut || todayKey();
  $('#abs-start').value = k;
  $('#abs-end').value = a.date_fin || k;
  $('#absence-title').textContent = absId ? "Modifier l'absence" : 'Nouvelle absence';
  $('#abs-delete').hidden = !absId;
  setMoment(a.moment || 'journee');
  openDialog('#dlg-absence');
}
$('#absence-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const s = $('#abs-start').value, e = absMoment === 'journee' ? $('#abs-end').value : s;
  if (!s || !e || e < s) return toast('Vérifiez les dates.', { error: true });
  const btn = ev.submitter;
  await busy(btn, async () => {
    try {
      const r = await store.saveAbsence({ type_absence: typeSel.value, moment: absMoment, date_debut: s, date_fin: e }, absId);
      closeDialog('#dlg-absence');
      toast(r.offline ? 'Absence enregistrée hors-ligne' : 'Absence enregistrée');
    } catch (err) { toast(errMsg(err), { error: true }); }
  });
});
$('#abs-delete').addEventListener('click', async () => {
  closeDialog('#dlg-absence');
  try {
    const removed = await store.deleteAbsence(absId);
    toast('Absence supprimée', { action: removed ? () => store.restoreAbsence(removed).catch((e) => toast(errMsg(e), { error: true })) : null });
  } catch (err) { toast(errMsg(err), { error: true }); }
});

export { dayKey };
