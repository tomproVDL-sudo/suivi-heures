// Vue « Réglages » : paramètres de temps de travail, soldes, affichage, compte.
import { $, $$, esc, pad, fmtNum } from '../util.js';
import * as store from '../store.js';
import { icon } from '../icons.js';
import { toast, errMsg, busy, confirmDialog } from '../ui.js';
import { APP_VERSION } from '../config.js';

export const meta = { title: 'Réglages', sub: 'Temps de travail, soldes et préférences', static: true };

const num = (id, label, v, step = '0.5', hint = '') => `<label class="field"><span>${label}</span><input class="input" type="number" inputmode="decimal" step="${step}" id="${id}" value="${esc(v ?? '')}">${hint ? `<small>${hint}</small>` : ''}</label>`;
const hm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const toMin = (s) => { const [h, m] = String(s || '0:0').split(':').map(Number); return h * 60 + (m || 0); };

export function render(el) {
  const p = store.state.params, pr = store.state.prefs, st = store.state;
  const hist = pr.basesHistoriques || [];
  el.innerHTML = `
  <form id="settings-form" class="grid g2">
    <div class="card"><div class="card-head"><div class="card-title">Temps de travail</div></div>
      <div class="grid g2">
        ${num('p-objectif', 'Objectif annuel (h)', p.objectif_annuel, '1')}
        ${num('p-base', 'Base hebdomadaire (h)', p.base_horaire, '0.5', `${fmtNum((+p.base_horaire || 39) / 5, 2)} h par jour`)}
        ${num('p-limite', 'Alerte dépassement (h/jour)', p.limite_heures_jour, '0.5')}
        <label class="field"><span>Notifications</span><label class="check" style="height:42px"><input type="checkbox" id="p-notifs" ${p.notifs_actives ? 'checked' : ''}> Activer l'alerte</label></label>
      </div>
      <div class="section-title" style="margin-top:18px">Historique de la base horaire</div>
      <p class="small muted" style="margin-bottom:8px">Pour les périodes passées avec une autre base (ex. 35 h jusqu'à fin 2021). Après la dernière date, la base hebdomadaire ci-dessus s'applique.</p>
      <div id="hist" class="list">${hist.map(histRow).join('')}</div>
      <button type="button" class="btn btn-sm" id="hist-add" style="margin-top:8px">${icon('plus')} Ajouter une période</button>
    </div>

    <div class="card"><div class="card-head"><div class="card-title">Soldes de l'année ${new Date().getFullYear()}</div></div>
      <div class="grid g2">
        ${num('p-cp', 'Congés payés N (j)', p.cp_initial)}
        ${num('p-reliquat', 'Reliquat CP N-1 (j)', p.reliquat_cp)}
        <label class="field span-all"><span>Date limite du reliquat</span><input class="input" type="date" id="p-limite-rel" value="${esc(p.date_limite_reliquat || '')}"><small>Le reliquat est consommé en priorité jusqu'à cette date, puis expire.</small></label>
        ${num('p-rtt', 'RTT (j)', p.rtt_initial)}
        ${num('p-cet', 'Solde CET (j)', p.cet_initial)}
        ${num('p-recup', 'Heures à récupérer (h)', p.recup_initial)}
        ${num('p-don', 'Don de jours (+/-)', p.don_jours)}
      </div>
    </div>

    <div class="card"><div class="card-head"><div class="card-title">Affichage</div></div>
      <div class="field"><span class="label">Thème</span>
        <div class="seg" id="theme-seg">${[['auto', 'Automatique'], ['light', 'Clair'], ['dark', 'Sombre']].map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${(pr.theme || 'auto') === v}">${l}</button>`).join('')}</div>
      </div>
      <div class="grid g2" style="margin-top:14px">
        <label class="field"><span>Bulle orange à partir de</span><input class="input" type="time" id="pr-orange" value="${hm(pr.seuilOrangeMin)}"></label>
        <label class="field"><span>Bulle rouge au-delà de</span><input class="input" type="time" id="pr-rouge" value="${hm(pr.seuilRougeMin)}"></label>
      </div>
    </div>

    <div class="card"><div class="card-head"><div class="card-title">Compte & synchronisation</div></div>
      <div class="list">
        <div class="list-item"><div class="main"><div>${esc(st.user?.email || '')}</div><div class="small muted">${st.pointages.length.toLocaleString('fr-FR')} pointages · ${st.absences.length} absences en cache sur cet appareil</div></div></div>
      </div>
      <div class="row wrap" style="margin-top:12px">
        <button type="button" class="btn" id="full-sync">${icon('refresh')} Tout resynchroniser</button>
        <button type="button" class="btn btn-danger" id="logout">${icon('logout')} Déconnexion</button>
      </div>
      <p class="xs faint" style="margin-top:12px">Version ${APP_VERSION}</p>
    </div>

    <div class="span-all row" style="justify-content:flex-end; position:sticky; bottom:12px">
      <button type="submit" class="btn btn-primary btn-lg" id="settings-save">${icon('check')} Enregistrer les réglages</button>
    </div>
  </form>`;

  $$('#theme-seg button', el).forEach((b) => b.addEventListener('click', () => {
    store.savePrefs({ theme: b.dataset.v });
  }));
  $('#hist-add', el).addEventListener('click', () => { $('#hist', el).insertAdjacentHTML('beforeend', histRow({ jusqua: '', heures: 35 })); });
  $('#hist', el).addEventListener('click', (e) => { if (e.target.closest('[data-del]')) e.target.closest('.list-item').remove(); });
  $('#p-notifs', el).addEventListener('change', async (e) => {
    if (e.target.checked && 'Notification' in window && Notification.permission !== 'granted') {
      const r = await Notification.requestPermission();
      if (r !== 'granted') { e.target.checked = false; toast('Notifications refusées par le navigateur.', { error: true }); }
    }
  });
  $('#full-sync', el).addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const ok = await store.sync({ full: true });
    toast(ok ? 'Toutes les données ont été rechargées.' : `Échec : ${store.state.lastError}`, { error: !ok });
  }));
  $('#logout', el).addEventListener('click', async () => {
    const pending = store.state.queue.length;
    if (pending && !(await confirmDialog({ title: 'Modifications non envoyées', body: `<p>${pending} modification(s) faites hors-ligne n'ont pas encore été envoyées et seront perdues.</p>`, okLabel: 'Se déconnecter quand même', danger: true }))) return;
    await store.logout(); location.hash = ''; location.reload();
  });
  $('#settings-form', el).addEventListener('submit', (e) => {
    e.preventDefault();
    busy($('#settings-save', el), () => save(el));
  });
}

function histRow(h) {
  return `<div class="list-item"><label class="field" style="flex:1"><span>Jusqu'au</span><input class="input sm" type="date" data-h="date" value="${esc(h.jusqua)}"></label>
  <label class="field" style="width:110px"><span>Heures/sem.</span><input class="input sm" type="number" step="0.5" data-h="heures" value="${esc(h.heures)}"></label>
  <button type="button" class="btn btn-ghost icon-btn" data-del aria-label="Supprimer" style="align-self:end">${icon('trash')}</button></div>`;
}

async function save(el) {
  const v = (id) => $(id, el).value;
  const f = (id, d = 0) => { const x = parseFloat(String(v(id)).replace(',', '.')); return Number.isFinite(x) ? x : d; };
  const params = {
    objectif_annuel: f('#p-objectif', 1607), base_horaire: f('#p-base', 39), limite_heures_jour: f('#p-limite', 10),
    notifs_actives: $('#p-notifs', el).checked, cp_initial: f('#p-cp'), reliquat_cp: f('#p-reliquat'),
    date_limite_reliquat: v('#p-limite-rel') || '', rtt_initial: f('#p-rtt'), cet_initial: f('#p-cet'),
    recup_initial: f('#p-recup'), don_jours: f('#p-don'),
  };
  if (params.base_horaire <= 0 || params.base_horaire > 60) return toast('Base hebdomadaire invalide.', { error: true });
  const hist = $$('#hist .list-item', el).map((r) => ({ jusqua: r.querySelector('[data-h=date]').value, heures: parseFloat(r.querySelector('[data-h=heures]').value) }))
    .filter((h) => h.jusqua && h.heures > 0);
  const orange = toMin(v('#pr-orange')), rouge = toMin(v('#pr-rouge'));
  try {
    store.savePrefs({ basesHistoriques: hist, seuilOrangeMin: orange || 528, seuilRougeMin: rouge || 600 });
    await store.saveParams(params);
    toast('Réglages enregistrés');
  } catch (e) { toast(errMsg(e), { error: true }); }
}
