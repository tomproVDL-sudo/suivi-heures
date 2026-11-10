// Sauvegardes : fichier JSON complet, instantanés locaux automatiques, sauvegardes cloud (Supabase).
import { sha256, downloadBlob, pad, DAY } from './util.js';
import * as store from './store.js';
import { localBackups } from './db.js';
import { BACKUP, APP_VERSION } from './config.js';

const stripP = ({ _t, _d, ...r }) => r;

export async function buildBackup() {
  const s = store.state;
  const pointages = s.pointages.filter((p) => !store.isTmp(p.id)).map(stripP);
  const absences = s.absences.filter((a) => !store.isTmp(a.id));
  const data = { parametres: { ...s.params }, pointages, absences };
  const payload = {
    app: 'suivi-heures', format: 2, version: APP_VERSION, created_at: new Date().toISOString(), user: s.user?.email || '',
    counts: { pointages: pointages.length, absences: absences.length },
    range: { from: pointages[0]?.timestamp || null, to: pointages[pointages.length - 1]?.timestamp || null },
    prefs: { ...s.prefs }, data,
  };
  payload.checksum = await sha256(JSON.stringify(data));
  return payload;
}

export function backupFilename(d = new Date()) {
  return `sauvegarde-suivi-heures_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}h${pad(d.getMinutes())}.json`;
}

export async function downloadBackup(payload = null) {
  const p = payload || await buildBackup();
  downloadBlob(backupFilename(new Date(p.created_at)), new Blob([JSON.stringify(p)], { type: 'application/json' }));
  return p;
}

/** Lit et valide un fichier de sauvegarde. */
export async function readBackupFile(file) {
  let p;
  try { p = JSON.parse(await file.text()); } catch { throw new Error("Ce fichier n'est pas un JSON valide."); }
  return validateBackup(p);
}
export async function validateBackup(p) {
  if (!p || p.app !== 'suivi-heures' || !p.data || !Array.isArray(p.data.pointages) || !Array.isArray(p.data.absences)) {
    throw new Error("Ce fichier n'est pas une sauvegarde Suivi Heures.");
  }
  const sum = await sha256(JSON.stringify(p.data));
  p.integrity = !p.checksum || p.checksum === sum;
  return p;
}

const kP = (p) => `${p.type_action}|${Math.floor(Date.parse(p.timestamp) / 1000)}`;
const kA = (a) => `${a.type_absence}|${a.moment}|${a.date_debut}|${a.date_fin}`;

/** Calcule ce qu'apporterait une restauration en mode fusion. */
export function diffBackup(p) {
  const hasP = new Set(store.state.pointages.map(kP)), hasA = new Set(store.state.absences.map(kA));
  return {
    newPointages: p.data.pointages.filter((x) => !hasP.has(kP(x))),
    newAbsences: p.data.absences.filter((x) => !hasA.has(kA(x))),
  };
}

/**
 * Restaure une sauvegarde.
 * mode 'merge' : ajoute uniquement ce qui manque (rien n'est supprimé).
 * mode 'replace' : remplace toutes les données (un instantané de sécurité est créé avant).
 */
export async function restoreBackup(p, { mode = 'merge', withParams = false, onProgress } = {}) {
  if (!navigator.onLine) throw new Error('Une connexion est nécessaire pour restaurer.');
  await snapshotLocal('avant-restauration');
  let pts, abs;
  if (mode === 'replace') {
    onProgress?.('Suppression des données actuelles…', 0);
    await store.bulkDeleteAll('pointages');
    await store.bulkDeleteAll('absences');
    pts = p.data.pointages; abs = p.data.absences;
  } else {
    const d = diffBackup(p); pts = d.newPointages; abs = d.newAbsences;
  }
  const clean = (r) => { const { id, user_id, created_at, ...rest } = r; return rest; };
  await store.bulkInsert('pointages', pts.map(clean), (n, t) => onProgress?.(`Pointages ${n}/${t}`, n / Math.max(1, t)));
  await store.bulkInsert('absences', abs.map(clean), (n, t) => onProgress?.(`Absences ${n}/${t}`, n / Math.max(1, t)));
  if (withParams && p.data.parametres) {
    await store.saveParams(p.data.parametres);
    if (p.prefs) { const { theme, ...rest } = p.prefs; store.savePrefs(rest); }
  }
  await store.sync({ full: true });
  return { pointages: pts.length, absences: abs.length };
}

// ---------- Instantanés locaux (IndexedDB de l'appareil) ----------
export async function snapshotLocal(kind = 'auto') {
  if (!store.state.user) return null;
  const payload = await buildBackup();
  const id = await localBackups.add({ uid: store.state.user.id, created_at: payload.created_at, kind, counts: payload.counts, size: JSON.stringify(payload).length, payload });
  await pruneLocal();
  return id;
}
async function pruneLocal() {
  const list = await localBackups.list(store.state.user.id);
  const autos = list.filter((b) => b.kind === 'auto');
  for (const b of autos.slice(BACKUP.localKeep)) await localBackups.del(b.id);
  const others = list.filter((b) => b.kind !== 'auto');
  for (const b of others.slice(5)) await localBackups.del(b.id);
}

/** Lancé après chaque synchronisation réussie. */
export async function runAutoBackups() {
  const s = store.state;
  if (!s.user || !s.pointages.length) return;
  if (s.prefs.autoBackupLocal !== false) {
    const list = await localBackups.list(s.user.id);
    const last = list.find((b) => b.kind === 'auto');
    if (!last || Date.now() - Date.parse(last.created_at) > BACKUP.localEveryHours * 3600000) await snapshotLocal('auto');
  }
  if (s.prefs.autoBackupCloud !== false && navigator.onLine) {
    const list = await store.cloud.list();
    if (list) {
      const last = list.find((b) => b.kind === 'auto');
      if (!last || Date.now() - Date.parse(last.created_at) > BACKUP.cloudEveryDays * DAY) {
        const payload = await buildBackup();
        if (await store.cloud.save(payload, 'auto', 'Sauvegarde automatique')) await store.cloud.prune(BACKUP.cloudKeep);
      }
    }
  }
}
