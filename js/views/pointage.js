// Vue « Pointage » : la journée en cours.
import { $, esc, fmtDur, fmtTime, dayKey, parseDay, todayKey, startOfWeek, addDays, HOUR, MIN, equivalence, capitalize } from '../util.js';
import * as store from '../store.js';
import { icon } from '../icons.js';
import { toast, confirmDialog, errMsg } from '../ui.js';
import { eventRow } from '../dialogs.js';

const R = 84, CIRC = 2 * Math.PI * R;
let root;

export const meta = { title: 'Pointage', sub: () => capitalize(new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })) };

export function render(el) {
  root = el;
  const e = store.engine(), now = Date.now(), key = todayKey();
  const s = e.summary(key, now);
  const ot = e.overtime(now), obj = e.objectif(now);
  const hpdH = e.hpdMs(key) / HOUR;

  root.innerHTML = `
  <div class="today-grid">
    <div class="card">
      <div class="hero">
        <div class="gauge">
          <svg viewBox="0 0 200 200"><circle class="track" cx="100" cy="100" r="${R}" fill="none" stroke-width="14"/>
          <circle class="bar" id="g-bar" cx="100" cy="100" r="${R}" fill="none" stroke-width="14" stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC}"/></svg>
          <div class="center"><div class="big" id="g-work">0h00</div><div class="lbl" id="g-target"></div></div>
        </div>
        <div class="hero-info">
          <div class="status-pill" id="h-status"><span class="dot"></span><span></span></div>
          <div class="strong" id="h-remain" style="font-size:17px"></div>
          <div class="mini-stats">
            <div><div class="k">Arrivée</div><div class="v" id="h-first">--</div></div>
            <div><div class="k">Pauses</div><div class="v" id="h-pause">0 min</div></div>
            <div><div class="k">Amplitude</div><div class="v" id="h-amp">--</div></div>
          </div>
        </div>
      </div>
      <div class="punch">
        <button class="p-arrivee" data-punch="arrivee">${icon('play')}<span>Arrivée</span><small>Prise de poste</small></button>
        <button class="p-pause" data-punch="pause" id="btn-pause">${icon('coffee')}<span>Pause</span><small>Début de pause</small></button>
        <button class="p-depart" data-punch="depart">${icon('stop')}<span>Départ</span><small>Fin de poste</small></button>
      </div>
      <div style="margin-top:18px">
        <div class="timeline" id="tl"></div>
        <div class="timeline-axis" id="tl-axis"></div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">Pointages du jour</div>
        <button class="btn btn-sm" id="open-today">${icon('plus')} Ajouter</button></div>
      <div class="events" id="today-events">${s.n ? e.points(key).map((p) => eventRow(p)).join('') : '<div class="empty">Aucun pointage aujourd\'hui.<br>Appuyez sur « Arrivée » pour commencer.</div>'}</div>
    </div>
  </div>

  <div class="hs-strip" style="margin-top:16px">
    ${hsCard('Solde semaine', ot.week, hpdH)}${hsCard('Solde mois', ot.month, hpdH)}${hsCard('Solde année', ot.year, hpdH, true)}
  </div>

  <div class="grid g2" style="margin-top:16px">
    <div class="card"><div class="card-head"><div class="card-title">Cette semaine</div><div class="small muted" id="wk-total"></div></div><div class="week-bars" id="wk-bars"></div></div>
    <div class="card">
      <div class="card-head"><div class="card-title">Objectif annuel</div><span class="badge">${Math.round(obj.objectif / HOUR)} h</span></div>
      <div class="kpi-like">
        <div style="font-size:26px;font-weight:750" class="num">${fmtDur(obj.cumul)} <span class="small muted" style="font-weight:500">effectuées</span></div>
        <div class="progress" style="margin:10px 0"><div style="width:${(obj.progression * 100).toFixed(1)}%"></div></div>
        <div class="small muted">${obj.atteint
          ? `🎉 Objectif atteint le ${parseDay(obj.atteint).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`
          : `Reste ${fmtDur(obj.reste)}${obj.projection ? ` · au rythme actuel, atteint vers le <b>${parseDay(obj.projection).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</b>` : ''}`}</div>
      </div>
    </div>
  </div>`;

  root.querySelectorAll('[data-punch]').forEach((b) => b.addEventListener('click', () => punch(b.dataset.punch === 'pause' && b.dataset.mode === 'reprise' ? 'arrivee' : b.dataset.punch, b)));
  $('#open-today', root).addEventListener('click', () => import('../dialogs.js').then((m) => m.openDay(todayKey())));
  renderWeek(e, now);
  tick(now);
}

function hsCard(label, r, hpdH, equiv = false) {
  const h = r.delta / HOUR;
  return `<div class="kpi"><div class="k">${label}</div><div class="v ${r.delta >= 0 ? 'pos' : 'neg'}">${fmtDur(r.delta, { sign: true })}</div>
  <div class="s">${fmtDur(r.real)} / ${fmtDur(r.expected)}${equiv && equivalence(h, hpdH) ? ` · ${equivalence(h, hpdH)}` : ''}</div></div>`;
}

function renderWeek(e, now) {
  const start = startOfWeek(new Date(now));
  let tot = 0, totExp = 0, max = 0;
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i), k = dayKey(d);
    const s = e.summary(k, now), plan = e.dayPlan(k);
    const real = s.work + plan.credit;
    tot += real; totExp += plan.expected;
    days.push({ d, k, real, exp: plan.expected, abs: plan.abs, ferie: plan.ferie });
    max = Math.max(max, real, plan.expected);
  }
  max = Math.max(max, 9 * HOUR);
  $('#wk-total', root).innerHTML = `<b class="num">${fmtDur(tot)}</b> / ${fmtDur(totExp)}`;
  const tk = todayKey();
  $('#wk-bars', root).innerHTML = days.map((x) => `<div class="col${x.k === tk ? ' today' : ''}" title="${x.ferie ? esc(x.ferie) : x.abs.map((a) => a.type_absence).join(', ')}">
    <div class="bar-wrap">${x.exp ? `<div class="target" style="bottom:${(x.exp / max) * 100}%"></div>` : ''}<div class="b" style="height:${(x.real / max) * 100}%;${x.real > x.exp && x.exp ? 'background:var(--success)' : ''}"></div></div>
    <div class="v">${x.real ? fmtDur(x.real) : x.ferie ? 'Férié' : x.abs.length ? esc(x.abs[0].type_absence) : '–'}</div>
    <div>${x.d.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '')}</div></div>`).join('');
}

/** Mise à jour légère chaque seconde. */
export function tick(now = Date.now()) {
  if (!root || !root.isConnected || !$('#g-work', root)) return;
  const e = store.engine(), key = todayKey();
  const s = e.summary(key, now), plan = e.dayPlan(key);
  const real = s.work + plan.credit;
  const target = plan.expected || e.hpdMs(key);
  const limite = (+e.params.limite_heures_jour || 10) * HOUR;
  const ratio = Math.min(1, real / target);
  const bar = $('#g-bar', root);
  bar.style.strokeDashoffset = String(CIRC * (1 - ratio));
  bar.classList.toggle('over', real >= target);
  bar.classList.toggle('alert', real >= limite);
  $('#g-work', root).textContent = fmtDur(real);
  $('#g-target', root).textContent = plan.expected ? `sur ${fmtDur(plan.expected)}` : plan.ferie ? `Férié · ${plan.ferie}` : plan.we ? 'Week-end' : 'Journée non travaillée';

  const st = $('#h-status', root);
  const labels = { none: 'Pas encore arrivé', work: 'En poste', pause: 'En pause', done: 'Journée terminée' };
  st.className = `status-pill ${s.status}`;
  st.lastElementChild.textContent = labels[s.status] + (s.status === 'pause' && s.openPause ? ` depuis ${fmtDur(now - s.openPause)}` : '');

  const diff = target - real;
  let remain = '';
  if (s.status === 'work') remain = diff > 0 ? `Encore ${fmtDur(diff)} · fin estimée à ${fmtTime(now + diff)}` : `Objectif dépassé de ${fmtDur(-diff)}`;
  else if (s.status === 'pause') remain = diff > 0 ? `Encore ${fmtDur(diff)} après la reprise` : `Objectif atteint (+${fmtDur(-diff)})`;
  else if (s.status === 'done') remain = diff > 0 ? `Il manque ${fmtDur(diff)}` : `Journée à +${fmtDur(-diff)}`;
  else remain = plan.expected ? `Objectif du jour : ${fmtDur(plan.expected)}` : '';
  if (s.status === 'work' && real > 6 * HOUR && s.pause < 20 * MIN) remain += ' · pensez à faire une pause';
  $('#h-remain', root).textContent = remain;
  $('#h-first', root).textContent = s.first ? fmtTime(s.first) : '--';
  $('#h-pause', root).textContent = s.pause >= HOUR ? fmtDur(s.pause) : `${Math.floor(s.pause / MIN)} min`;
  $('#h-amp', root).textContent = s.amplitude ? fmtDur(s.amplitude) : '--';

  // Boutons : mise en avant de l'action suivante, « Reprise » pendant une pause
  const next = s.status === 'work' ? (real >= target ? 'depart' : 'pause') : s.status === 'pause' ? 'pause' : 'arrivee';
  root.querySelectorAll('[data-punch]').forEach((b) => b.classList.toggle('next', b.dataset.punch === next));
  const bp = $('#btn-pause', root);
  const rep = s.status === 'pause';
  bp.dataset.mode = rep ? 'reprise' : '';
  bp.querySelector('span').textContent = rep ? 'Reprise' : 'Pause';
  bp.querySelector('small').textContent = rep ? 'Reprendre le travail' : 'Début de pause';

  renderTimeline(s, now);
  notify(real, limite);
}

function renderTimeline(s, now) {
  const tl = $('#tl', root); if (!tl) return;
  const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
  const first = s.first ?? now;
  let from = Math.min(first, d0.getTime() + 7 * HOUR), to = Math.max(s.last ?? now, now, d0.getTime() + 19 * HOUR);
  from = Math.floor((from - d0) / HOUR) * HOUR + d0.getTime();
  to = Math.ceil((to - d0) / HOUR) * HOUR + d0.getTime();
  const span = to - from, pct = (t) => (((t - from) / span) * 100).toFixed(2);
  tl.innerHTML = s.segments.map((g) => `<div class="${g.type === 'work' ? 'seg-w' : 'seg-p'}${g.live ? ' live' : ''}" style="left:${pct(g.s)}%;width:${((g.e - g.s) / span * 100).toFixed(2)}%" title="${g.type === 'work' ? 'Travail' : 'Pause'} ${fmtTime(g.s)}–${fmtTime(g.e)}"></div>`).join('')
    + (now >= from && now <= to ? `<div class="now" style="left:${pct(now)}%"></div>` : '');
  const ticks = [];
  const step = span > 14 * HOUR ? 3 : 2;
  for (let t = from; t <= to; t += step * HOUR) ticks.push(`<span>${new Date(t).getHours()}h</span>`);
  $('#tl-axis', root).innerHTML = ticks.join('');
}

function notify(real, limite) {
  if (!store.state.params.notifs_actives || real < limite) return;
  const k = `sh_notif_${todayKey()}`;
  if (localStorage.getItem(k)) return;
  localStorage.setItem(k, '1');
  const msg = `Seuil de ${fmtDur(limite)} de travail atteint aujourd'hui.`;
  toast(`⚠️ ${msg}`, { error: true, duration: 8000 });
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      navigator.serviceWorker?.ready.then((r) => r.showNotification('Suivi Heures', { body: msg, icon: 'icons/icon-192.png' }))
        .catch(() => new Notification('Suivi Heures', { body: msg }));
    }
  } catch { /* ignore */ }
}

let lastPunch = 0;
async function punch(type, btn) {
  if (Date.now() - lastPunch < 1200) return; // anti double-clic
  const pts = store.engine().points(todayKey());
  const last = pts[pts.length - 1];
  if (last && last.type_action === type && Date.now() - last._t < 5 * MIN) {
    const ok = await confirmDialog({ title: 'Pointage en double ?', body: `<p>Vous avez déjà pointé « ${type === 'arrivee' ? 'Arrivée' : type === 'pause' ? 'Pause' : 'Départ'} » à ${fmtTime(last._t)}. Pointer à nouveau ?</p>`, okLabel: 'Pointer quand même' });
    if (!ok) return;
  }
  lastPunch = Date.now();
  btn?.animate?.([{ transform: 'scale(.95)' }, { transform: 'scale(1)' }], { duration: 180 });
  try {
    const r = await store.addPointage(type, new Date());
    const labels = { arrivee: 'Arrivée enregistrée', pause: 'Bonne pause !', depart: 'Bonne fin de journée !' };
    toast(r.offline ? 'Hors-ligne : pointage gardé sur l’appareil, il sera envoyé automatiquement.' : `${labels[type]} (${fmtTime(Date.now())})`);
  } catch (e) { toast(errMsg(e), { error: true }); }
}
