// Vue « Données » : exports, sauvegardes (fichier / appareil / cloud), import.
import { $, $$, esc, dayKey, parseDay, startOfWeek, addDays, fmtNum } from '../util.js';
import * as store from '../store.js';
import { localBackups } from '../db.js';
import { icon } from '../icons.js';
import { toast, confirmDialog, errMsg, busy } from '../ui.js';
import * as exp from '../export.js';
import * as bk from '../backup.js';
import { parseImport, commitImport } from '../importer.js';
import { BACKUP } from '../config.js';

export const meta = { title: 'Données', sub: 'Exports, sauvegardes et import', static: true };

let range = null, preset = 'month';
function setPreset(p) {
  const n = new Date(), y = n.getFullYear(), m = n.getMonth();
  preset = p;
  if (p === 'week') { const s = startOfWeek(n); range = [s, addDays(s, 6)]; }
  if (p === 'month') range = [new Date(y, m, 1), new Date(y, m + 1, 0)];
  if (p === 'lastmonth') range = [new Date(y, m - 1, 1), new Date(y, m, 0)];
  if (p === 'year') range = [new Date(y, 0, 1), new Date(y, 11, 31)];
  if (p === 'lastyear') range = [new Date(y - 1, 0, 1), new Date(y - 1, 11, 31)];
}
setPreset('month');

const fmtDT = (iso) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const kindLabel = { auto: 'Automatique', manuelle: 'Manuelle', 'avant-restauration': 'Avant restauration', instantane: 'Instantané' };

export function render(el) {
  const pr = store.state.prefs;
  el.innerHTML = `
  <div class="grid g2">
    <div class="card span2">
      <div class="card-head"><div><div class="card-title">Exporter</div><div class="card-sub">Excel détaillé (synthèse, journalier, hebdo, mensuel, pointages, absences), rapport PDF, CSV ou agenda</div></div></div>
      <div class="row wrap between" style="gap:12px">
        <div class="seg" id="ex-presets">${[['week', 'Cette semaine'], ['month', 'Ce mois'], ['lastmonth', 'Mois dernier'], ['year', 'Cette année'], ['lastyear', 'Année dernière']].map(([v, l]) => `<button data-v="${v}" aria-pressed="${preset === v}">${l}</button>`).join('')}</div>
        <div class="row">
          <input class="input sm" type="date" id="ex-start" value="${dayKey(range[0])}" aria-label="Du">
          <span class="muted">→</span>
          <input class="input sm" type="date" id="ex-end" value="${dayKey(range[1])}" aria-label="Au">
        </div>
      </div>
      <div class="row wrap" style="margin-top:14px">
        <button class="btn btn-primary" id="ex-xlsx">${icon('sheet')} Excel</button>
        <button class="btn" id="ex-pdf">${icon('file')} PDF</button>
        <button class="btn" id="ex-print">${icon('file')} Rapport imprimable</button>
        <button class="btn" id="ex-csv">${icon('download')} CSV des pointages</button>
        <button class="btn" id="ex-ics">${icon('calendar')} Absences → agenda (.ics)</button>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div><div class="card-title">Sauvegarde complète</div><div class="card-sub">Pointages, absences, paramètres et préférences dans un seul fichier</div></div></div>
      <div class="stack">
        <div class="row wrap">
          <button class="btn btn-primary" id="bk-download">${icon('download')} Télécharger une sauvegarde</button>
          <button class="btn" id="bk-restore-file">${icon('upload')} Restaurer un fichier…</button>
          <input type="file" id="bk-file" accept=".json,application/json" hidden>
        </div>
        <div id="bk-progress" hidden><div class="small muted" id="bk-progress-txt"></div><div class="progress" style="margin-top:6px"><div id="bk-progress-bar" style="width:0%"></div></div></div>
        <div class="notice">${icon('info')}<div>La restauration propose deux modes : <b>fusionner</b> (n'ajoute que ce qui manque, sans rien supprimer) ou <b>remplacer</b>. Un instantané de sécurité est toujours créé juste avant.</div></div>
      </div>
      <div class="section-title" style="margin-top:20px">Sur cet appareil</div>
      <label class="check small" style="margin-bottom:8px"><input type="checkbox" id="auto-local" ${pr.autoBackupLocal !== false ? 'checked' : ''}> Instantané automatique quotidien (${BACKUP.localKeep} derniers conservés)</label>
      <div class="list" id="local-list"><div class="empty"><span class="spinner sm"></span></div></div>
      <button class="btn btn-sm" id="local-now" style="margin-top:8px">${icon('plus')} Créer un instantané maintenant</button>
    </div>

    <div class="card">
      <div class="card-head"><div><div class="card-title">Sauvegardes dans le cloud</div><div class="card-sub">Stockées dans votre base Supabase, accessibles depuis tous vos appareils</div></div></div>
      <div id="cloud-zone"><div class="empty"><span class="spinner sm"></span></div></div>
    </div>

    <div class="card span2">
      <div class="card-head"><div><div class="card-title">Importer depuis Excel</div><div class="card-sub">Les doublons (déjà présents) sont ignorés automatiquement</div></div></div>
      <div class="grid g2">
        <div class="stack" style="gap:8px">
          <div class="strong">Pointages</div>
          <div class="small muted">Colonnes : <code>Date</code>, <code>Heure</code>, <code>Action</code> (Arrivée, Pause, Départ). La feuille « Pointages » de l'export Excel est ré-importable telle quelle.</div>
          <div class="row wrap"><button class="btn" id="imp-p">${icon('upload')} Importer des pointages</button><button class="btn btn-ghost btn-sm" id="tpl-p">Modèle</button></div>
          <input type="file" id="imp-p-file" accept=".xlsx,.xls,.csv" hidden>
        </div>
        <div class="stack" style="gap:8px">
          <div class="strong">Absences</div>
          <div class="small muted">Colonnes : <code>Date</code>, <code>Date fin</code> (optionnelle), <code>Type</code> (CP, RTT, CET, AEA, Formation, Maladie), <code>Moment</code> (journee, matin, aprem).</div>
          <div class="row wrap"><button class="btn" id="imp-a">${icon('upload')} Importer des absences</button><button class="btn btn-ghost btn-sm" id="tpl-a">Modèle</button></div>
          <input type="file" id="imp-a-file" accept=".xlsx,.xls,.csv" hidden>
        </div>
      </div>
    </div>
  </div>`;

  // --- Export ---
  $$('#ex-presets button', el).forEach((b) => b.addEventListener('click', () => { setPreset(b.dataset.v); render(el); }));
  const readRange = () => {
    const s = $('#ex-start', el).value, e = $('#ex-end', el).value;
    if (!s || !e || e < s) { toast('Période invalide', { error: true }); return null; }
    return [parseDay(s), parseDay(e)];
  };
  ['#ex-start', '#ex-end'].forEach((id) => $(id, el).addEventListener('change', () => { preset = 'custom'; $$('#ex-presets button', el).forEach((b) => b.setAttribute('aria-pressed', 'false')); }));
  const run = (id, fn, okMsg) => $(id, el).addEventListener('click', (ev) => {
    const r = readRange(); if (!r) return;
    busy(ev.currentTarget, async () => { try { const out = await fn(...r); if (okMsg) toast(okMsg(out)); } catch (e) { toast(errMsg(e), { error: true }); } });
  });
  run('#ex-xlsx', exp.exportExcel, () => 'Fichier Excel téléchargé');
  run('#ex-pdf', exp.exportPDF, () => 'Rapport PDF téléchargé');
  run('#ex-print', async (s, e) => exp.printableReport(s, e));
  run('#ex-csv', async (s, e) => exp.exportCSV(s, e), (n) => `${n} pointages exportés`);
  run('#ex-ics', async (s, e) => exp.exportICS(s, e), (n) => `${n} absence(s) exportée(s)`);

  // --- Sauvegarde fichier ---
  $('#bk-download', el).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
    const p = await bk.downloadBackup();
    toast(`Sauvegarde téléchargée (${p.counts.pointages} pointages, ${p.counts.absences} absences)`);
  }));
  $('#bk-restore-file', el).addEventListener('click', () => $('#bk-file', el).click());
  $('#bk-file', el).addEventListener('change', async (ev) => {
    const f = ev.target.files[0]; ev.target.value = '';
    if (!f) return;
    try { await restoreFlow(el, await bk.readBackupFile(f)); } catch (e) { toast(errMsg(e), { error: true }); }
  });
  $('#auto-local', el).addEventListener('change', (ev) => store.savePrefs({ autoBackupLocal: ev.target.checked }));
  $('#local-now', el).addEventListener('click', (ev) => busy(ev.currentTarget, async () => { await bk.snapshotLocal('instantane'); toast('Instantané créé'); renderLocal(el); }));

  // --- Import ---
  const imp = (btn, input, kind) => {
    $(btn, el).addEventListener('click', () => $(input, el).click());
    $(input, el).addEventListener('change', async (ev) => {
      const f = ev.target.files[0]; ev.target.value = '';
      if (!f) return;
      try { await importFlow(el, f, kind); } catch (e) { toast(errMsg(e), { error: true }); }
    });
  };
  imp('#imp-p', '#imp-p-file', 'pointages');
  imp('#imp-a', '#imp-a-file', 'absences');
  $('#tpl-p', el).addEventListener('click', () => exp.downloadTemplate('pointages').catch((e) => toast(errMsg(e), { error: true })));
  $('#tpl-a', el).addEventListener('click', () => exp.downloadTemplate('absences').catch((e) => toast(errMsg(e), { error: true })));

  renderLocal(el);
  renderCloud(el);
}

function progress(el, txt, ratio) {
  const box = $('#bk-progress', el); if (!box) return;
  box.hidden = txt == null;
  if (txt != null) { $('#bk-progress-txt', el).textContent = txt; $('#bk-progress-bar', el).style.width = `${Math.round((ratio || 0) * 100)}%`; }
}

async function restoreFlow(el, p) {
  if (!navigator.onLine) { toast('Une connexion est nécessaire pour restaurer.', { error: true }); return; }
  progress(el, 'Comparaison avec les données en ligne…', 0.1);
  await store.sync({ full: true }); // compare avec l'état réel du serveur
  progress(el, null);
  const d = bk.diffBackup(p);
  const ok = await confirmDialog({
    title: 'Restaurer la sauvegarde',
    okLabel: 'Restaurer',
    body: `<div class="stack" style="gap:12px">
      <div class="list-item"><div class="main"><div>Sauvegarde du ${fmtDT(p.created_at)}</div><div class="small muted">${p.counts.pointages.toLocaleString('fr-FR')} pointages · ${p.counts.absences} absences${p.user ? ` · ${esc(p.user)}` : ''}</div></div>
      ${p.integrity ? `<span class="badge pos">${icon('check')} Intègre</span>` : '<span class="badge neg">Fichier modifié</span>'}</div>
      <label class="check"><input type="radio" name="rmode" value="merge" checked> <span><b>Fusionner</b> — ajoute ${d.newPointages.length} pointage(s) et ${d.newAbsences.length} absence(s) manquants</span></label>
      <label class="check"><input type="radio" name="rmode" value="replace"> <span><b>Remplacer</b> — supprime les données actuelles et restaure la sauvegarde</span></label>
      <label class="check"><input type="checkbox" id="rparams"> Restaurer aussi les paramètres (soldes, base horaire…)</label>
    </div>`,
  });
  if (!ok) return;
  const mode = document.querySelector('input[name=rmode]:checked')?.value || 'merge';
  const withParams = document.querySelector('#rparams')?.checked;
  if (mode === 'replace' && !(await confirmDialog({ title: 'Remplacer toutes les données ?', body: '<p>Les pointages et absences actuels seront supprimés de Supabase puis remplacés par ceux de la sauvegarde. Un instantané de sécurité est créé sur cet appareil juste avant.</p>', okLabel: 'Oui, remplacer', danger: true }))) return;
  try {
    const r = await bk.restoreBackup(p, { mode, withParams, onProgress: (t, x) => progress(el, t, x) });
    toast(`Restauration terminée : ${r.pointages} pointages et ${r.absences} absences ${mode === 'merge' ? 'ajoutés' : 'restaurés'}.`);
  } catch (e) { toast(`Échec de la restauration : ${errMsg(e)}`, { error: true }); } finally { progress(el, null); renderLocal(el); }
}

async function importFlow(el, file, kind) {
  const r = await parseImport(file, kind);
  if (!r.rows.length) {
    toast(r.dups ? `Rien à importer : ${r.dups} ligne(s) déjà présentes.` : 'Aucune ligne valide. Vérifiez les noms des colonnes.', { error: !r.dups });
    return;
  }
  const label = kind === 'pointages' ? 'pointage(s)' : 'absence(s)';
  const ok = await confirmDialog({
    title: `Importer des ${kind}`,
    body: `<p><b>${r.rows.length}</b> ${label} à importer.</p><p class="small muted">${r.dups} doublon(s) ignoré(s) · ${r.skipped} ligne(s) illisible(s) sur ${r.total}.</p>`,
    okLabel: 'Importer',
  });
  if (!ok) return;
  await bk.snapshotLocal('avant-restauration').catch(() => {});
  try {
    await commitImport(kind, r.rows, (n, t) => progress(el, `Import ${n}/${t}`, n / t));
    toast(`${r.rows.length} ${label} importé(s)`);
  } finally { progress(el, null); }
}

async function renderLocal(el) {
  const box = $('#local-list', el); if (!box || !store.state.user) return;
  const list = await localBackups.list(store.state.user.id);
  if (!box.isConnected) return;
  box.innerHTML = list.length ? list.map((b) => `<div class="list-item"><div class="main"><div>${fmtDT(b.created_at)}</div><div class="small muted">${kindLabel[b.kind] || b.kind} · ${b.counts.pointages.toLocaleString('fr-FR')} pointages · ${b.counts.absences} absences · ${fmtNum(b.size / 1048576, 1)} Mo</div></div>
    <div class="row"><button class="btn btn-ghost icon-btn sm" data-ldl="${b.id}" title="Télécharger">${icon('download')}</button><button class="btn btn-ghost icon-btn sm" data-lrs="${b.id}" title="Restaurer">${icon('history')}</button><button class="btn btn-ghost icon-btn sm" data-ldel="${b.id}" title="Supprimer">${icon('trash')}</button></div></div>`).join('')
    : '<div class="empty small">Aucun instantané pour le moment.</div>';
  box.querySelectorAll('[data-ldl]').forEach((b) => b.addEventListener('click', async () => { const r = await localBackups.get(+b.dataset.ldl); bk.downloadBackup(r.payload); }));
  box.querySelectorAll('[data-lrs]').forEach((b) => b.addEventListener('click', async () => {
    const r = await localBackups.get(+b.dataset.lrs);
    try { await restoreFlow(el, await bk.validateBackup(r.payload)); } catch (e) { toast(errMsg(e), { error: true }); }
  }));
  box.querySelectorAll('[data-ldel]').forEach((b) => b.addEventListener('click', async () => { await localBackups.del(+b.dataset.ldel); renderLocal(el); }));
}

async function renderCloud(el) {
  const zone = $('#cloud-zone', el); if (!zone) return;
  if (!navigator.onLine) { zone.innerHTML = '<div class="notice warn">Hors-ligne : les sauvegardes cloud seront visibles une fois reconnecté.</div>'; return; }
  let list;
  try { list = await store.cloud.list(); } catch (e) { zone.innerHTML = `<div class="notice danger">${esc(errMsg(e))}</div>`; return; }
  if (!zone.isConnected) return;
  if (list === null) {
    zone.innerHTML = `<div class="notice warn">${icon('alert')}<div><b>À activer une seule fois.</b> Les sauvegardes cloud ont besoin d'une table <code>sauvegardes</code> dans Supabase.
      Ouvrez Supabase → <i>SQL Editor</i>, collez le contenu du fichier <code>supabase/sauvegardes.sql</code> fourni avec l'application, puis cliquez sur <i>Run</i>. Rechargez ensuite cette page.</div></div>`;
    return;
  }
  const pr = store.state.prefs;
  zone.innerHTML = `
    <label class="check small" style="margin-bottom:8px"><input type="checkbox" id="auto-cloud" ${pr.autoBackupCloud !== false ? 'checked' : ''}> Sauvegarde automatique hebdomadaire (${BACKUP.cloudKeep} dernières conservées)</label>
    <div class="list">${list.length ? list.map((b) => `<div class="list-item"><div class="main"><div>${fmtDT(b.created_at)}</div><div class="small muted">${kindLabel[b.kind] || esc(b.kind)} · ${(b.counts?.pointages ?? 0).toLocaleString('fr-FR')} pointages · ${b.counts?.absences ?? 0} absences</div></div>
      <div class="row"><button class="btn btn-ghost icon-btn sm" data-cdl="${b.id}" title="Télécharger">${icon('download')}</button><button class="btn btn-ghost icon-btn sm" data-crs="${b.id}" title="Restaurer">${icon('history')}</button><button class="btn btn-ghost icon-btn sm" data-cdel="${b.id}" title="Supprimer">${icon('trash')}</button></div></div>`).join('') : '<div class="empty small">Aucune sauvegarde cloud pour le moment.</div>'}</div>
    <button class="btn btn-sm" id="cloud-now" style="margin-top:8px">${icon('cloud')} Sauvegarder dans le cloud maintenant</button>`;
  $('#auto-cloud', zone).addEventListener('change', (ev) => store.savePrefs({ autoBackupCloud: ev.target.checked }));
  $('#cloud-now', zone).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
    try { await store.cloud.save(await bk.buildBackup(), 'manuelle', 'Sauvegarde manuelle'); toast('Sauvegarde envoyée dans le cloud'); renderCloud(el); } catch (e) { toast(errMsg(e), { error: true }); }
  }));
  zone.querySelectorAll('[data-cdl]').forEach((b) => b.addEventListener('click', (ev) => busy(ev.currentTarget, async () => bk.downloadBackup(await store.cloud.get(b.dataset.cdl)))));
  zone.querySelectorAll('[data-crs]').forEach((b) => b.addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
    try { await restoreFlow(el, await bk.validateBackup(await store.cloud.get(b.dataset.crs))); } catch (e) { toast(errMsg(e), { error: true }); }
  })));
  zone.querySelectorAll('[data-cdel]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'Supprimer cette sauvegarde ?', okLabel: 'Supprimer', danger: true }))) return;
    try { await store.cloud.remove(b.dataset.cdel); renderCloud(el); } catch (e) { toast(errMsg(e), { error: true }); }
  }));
}
