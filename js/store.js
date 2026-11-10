// État de l'application, cache local (IndexedDB), synchronisation Supabase et file hors-ligne.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { kv } from './db.js';
import { Engine, prepPointage, DEFAULT_PARAMS, DEFAULT_PREFS, rolloverParams } from './calc.js';
import { DAY, debounce } from './util.js';

export const supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

const PARAM_KEYS = Object.keys(DEFAULT_PARAMS);

function loadPrefs() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem('sh_prefs') || '{}'); } catch { /* ignore */ }
  // Reprise des préférences de l'ancienne version
  try {
    if (!p.counterOrder && localStorage.getItem('sirh_order')) p.counterOrder = JSON.parse(localStorage.getItem('sirh_order'));
    if (!p.hiddenCounters && localStorage.getItem('sirh_hidden')) p.hiddenCounters = JSON.parse(localStorage.getItem('sirh_hidden'));
  } catch { /* ignore */ }
  return { ...DEFAULT_PREFS, ...p };
}

export const state = {
  user: null,
  params: { ...DEFAULT_PARAMS },
  prefs: loadPrefs(),
  pointages: [],
  absences: [],
  queue: [],
  meta: {},
  syncing: false,
  online: navigator.onLine,
  cloudBackups: null, // null = inconnu, true/false = table disponible ou non
  lastError: null,
};

// ---------- Abonnements ----------
const listeners = new Set();
let version = 0, cachedEngine = null, cachedVersion = -1;
export const onChange = (fn) => listeners.add(fn);
function emit(kind) { listeners.forEach((fn) => { try { fn(kind); } catch (e) { console.error(e); } }); }
function changed() { version++; persist(); emit('data'); }
export function engine() {
  if (cachedVersion !== version) {
    cachedEngine = new Engine({ pointages: state.pointages, absences: state.absences, params: state.params, prefs: state.prefs });
    cachedVersion = version;
  }
  return cachedEngine;
}

export function savePrefs(patch) {
  Object.assign(state.prefs, patch);
  localStorage.setItem('sh_prefs', JSON.stringify(state.prefs));
  version++; emit('prefs');
}

// ---------- Cache local ----------
const key = (name) => `${state.user.id}:${name}`;
const persist = debounce(async () => {
  if (!state.user) return;
  try {
    await Promise.all([
      kv.set(key('pointages'), state.pointages), kv.set(key('absences'), state.absences),
      kv.set(key('params'), state.params), kv.set(key('queue'), state.queue), kv.set(key('meta'), state.meta),
    ]);
  } catch (e) { console.warn('Cache local indisponible', e); }
}, 300);

async function loadCache() {
  const [p, a, par, q, m] = await Promise.all(['pointages', 'absences', 'params', 'queue', 'meta'].map((n) => kv.get(key(n)).catch(() => null)));
  state.pointages = (p || []).map((x) => (x._t ? x : prepPointage(x)));
  state.absences = a || [];
  state.params = { ...DEFAULT_PARAMS, ...(par || {}) };
  state.queue = q || [];
  state.meta = m || {};
  // Reprise de la file hors-ligne de l'ancienne version
  try {
    const legacy = JSON.parse(localStorage.getItem('sirh_offline_queue') || '[]');
    for (const t of legacy) {
      if (t.type !== 'insert' || !t.data) continue;
      const tmp = tmpId();
      if (t.table === 'pointages') state.pointages.push(prepPointage({ ...t.data, id: tmp }));
      state.queue.push({ table: t.table, kind: 'insert', tmp, data: t.data });
    }
    localStorage.removeItem('sirh_offline_queue');
  } catch { /* ignore */ }
  sortPointages();
  version++;
  return state.pointages.length > 0 || state.absences.length > 0;
}

// ---------- Helpers ----------
let tmpSeq = 0;
const tmpId = () => `tmp-${Date.now()}-${tmpSeq++}`;
export const isTmp = (id) => String(id).startsWith('tmp-');
const sortPointages = () => state.pointages.sort((a, b) => a._t - b._t);
const prepFor = (table) => (table === 'pointages' ? prepPointage : (x) => x);
export const isNetErr = (e) => !navigator.onLine || /fetch|network|load failed|timeout|connexion/i.test(e?.message || '');

async function q(builder) {
  const { data, error, count } = await builder;
  if (error) { const err = new Error(error.message || 'Erreur Supabase'); err.code = error.code; throw err; }
  return { data, count };
}

/** Récupère toutes les lignes en paginant (contourne la limite de 1000 lignes de Supabase). */
async function fetchAll(build, pageSize = 1000) {
  const all = []; let from = 0, total = null;
  for (let guard = 0; guard < 1000; guard++) {
    const { data, count } = await q(build(from === 0).range(from, from + pageSize - 1));
    if (from === 0 && typeof count === 'number') total = count;
    all.push(...(data || []));
    from += (data || []).length;
    if (!data || !data.length) break;
    if (total != null ? from >= total : data.length < pageSize) break;
  }
  return all;
}

// ---------- Session ----------
export async function currentUser() {
  const { data } = await supa.auth.getSession();
  return data?.session?.user || null;
}
export async function login(email, password) {
  const { data, error } = await supa.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Email ou mot de passe incorrect.' : error.message);
  return data.user;
}
export async function logout() {
  if (state.user) {
    await Promise.all(['pointages', 'absences', 'params', 'meta'].map((n) => kv.del(key(n)).catch(() => {})));
  }
  await supa.auth.signOut().catch(() => {});
  state.user = null;
}

/** Ouvre la session : charge d'abord le cache local (affichage instantané). */
export async function openSession(user) {
  state.user = user;
  const hasCache = await loadCache();
  emit('data');
  return hasCache;
}

// ---------- Synchronisation ----------
export async function sync({ full = false } = {}) {
  if (!state.user || state.syncing || !navigator.onLine) return false;
  state.syncing = true; state.lastError = null; emit('sync');
  try {
    await flushQueue();
    const uid = state.user.id;
    const [{ data: p }, abs] = await Promise.all([
      q(supa.from('parametres').select('*').eq('user_id', uid).maybeSingle()),
      fetchAll((c) => supa.from('absences').select('*', c ? { count: 'exact' } : undefined).eq('user_id', uid).order('date_debut').order('id')),
    ]);
    if (p) state.params = { ...DEFAULT_PARAMS, ...pick(p) };
    state.absences = abs;

    const pending = state.pointages.filter((x) => isTmp(x.id));
    const needFull = full || !state.meta.lastFull || Date.now() - state.meta.lastFull > 7 * DAY || !state.pointages.some((x) => !isTmp(x.id));
    if (needFull) {
      const pts = await fetchAll((c) => supa.from('pointages').select('*', c ? { count: 'exact' } : undefined).eq('user_id', uid).order('timestamp').order('id'));
      state.pointages = [...pts.map(prepPointage), ...pending];
      state.meta.lastFull = Date.now();
    } else {
      // Synchro rapide : uniquement l'année en cours (et au moins les 45 derniers jours)
      const now = new Date();
      const ws = Math.min(new Date(now.getFullYear(), 0, 1).getTime(), now.getTime() - 45 * DAY);
      const pts = await fetchAll((c) => supa.from('pointages').select('*', c ? { count: 'exact' } : undefined).eq('user_id', uid).gte('timestamp', new Date(ws).toISOString()).order('timestamp').order('id'));
      state.pointages = [...state.pointages.filter((x) => x._t < ws && !isTmp(x.id)), ...pts.map(prepPointage), ...pending];
    }
    sortPointages();
    state.meta.lastSync = Date.now();
    version++;
    // Passage d'année : report du reliquat de CP
    const np = rolloverParams(engine(), new Date().getFullYear());
    if (np) await saveParams(np);
    changed();
    return true;
  } catch (e) {
    state.lastError = e.message;
    console.warn('Synchronisation', e);
    return false;
  } finally {
    state.syncing = false; emit('sync');
  }
}

const pick = (p) => Object.fromEntries(PARAM_KEYS.filter((k) => p[k] !== undefined && p[k] !== null).map((k) => [k, p[k]]));

function enqueue(op) { state.queue.push(op); persist(); emit('sync'); }

export async function flushQueue() {
  if (!state.queue.length || !navigator.onLine) return 0;
  let done = 0;
  while (state.queue.length) {
    const op = state.queue[0];
    try {
      if (op.kind === 'insert') {
        const { data } = await q(supa.from(op.table).insert(op.data).select().single());
        replaceLocal(op.table, op.tmp, prepFor(op.table)(data));
      } else if (op.kind === 'update') {
        await q(supa.from(op.table).update(op.data).eq('id', op.id));
      } else if (op.kind === 'delete') {
        await q(supa.from(op.table).delete().eq('id', op.id));
      } else if (op.kind === 'upsert') {
        await q(supa.from(op.table).upsert(op.data));
      }
      state.queue.shift(); done++;
    } catch (e) {
      if (isNetErr(e)) break;
      console.warn('Opération hors-ligne abandonnée', op, e);
      state.lastError = `Une modification hors-ligne a été refusée : ${e.message}`;
      state.queue.shift();
    }
  }
  if (done) changed(); else persist();
  emit('sync');
  return done;
}

function replaceLocal(table, id, row) {
  const coll = state[table];
  const i = coll.findIndex((x) => x.id === id);
  if (i >= 0) coll[i] = row; else coll.push(row);
  if (table === 'pointages') sortPointages();
}

// ---------- Mutations génériques (optimistes + hors-ligne) ----------
async function insertRow(table, row) {
  const prep = prepFor(table);
  const local = prep({ ...row, id: tmpId() });
  state[table].push(local);
  if (table === 'pointages') sortPointages();
  changed();
  try {
    const { data } = await q(supa.from(table).insert(row).select().single());
    replaceLocal(table, local.id, prep(data)); changed();
    return { row: data, offline: false };
  } catch (e) {
    if (isNetErr(e)) { enqueue({ table, kind: 'insert', tmp: local.id, data: row }); return { row: local, offline: true }; }
    state[table] = state[table].filter((x) => x.id !== local.id); changed();
    throw e;
  }
}

async function updateRow(table, id, patch) {
  const prep = prepFor(table), coll = state[table];
  const i = coll.findIndex((x) => x.id === id);
  if (i < 0) throw new Error('Élément introuvable');
  const before = coll[i];
  coll[i] = prep({ ...before, ...patch });
  if (table === 'pointages') sortPointages();
  changed();
  if (isTmp(id)) {
    const op = state.queue.find((o) => o.kind === 'insert' && o.tmp === id);
    if (op) Object.assign(op.data, patch);
    persist(); return { offline: true };
  }
  try {
    await q(supa.from(table).update(patch).eq('id', id));
    return { offline: false };
  } catch (e) {
    if (isNetErr(e)) { enqueue({ table, kind: 'update', id, data: patch }); return { offline: true }; }
    const j = state[table].findIndex((x) => x.id === id); if (j >= 0) state[table][j] = before;
    changed(); throw e;
  }
}

async function deleteRow(table, id) {
  const coll = state[table];
  const removed = coll.find((x) => x.id === id);
  state[table] = coll.filter((x) => x.id !== id);
  changed();
  if (isTmp(id)) { state.queue = state.queue.filter((o) => o.tmp !== id); persist(); return removed; }
  try {
    await q(supa.from(table).delete().eq('id', id));
  } catch (e) {
    if (isNetErr(e)) enqueue({ table, kind: 'delete', id });
    else { if (removed) state[table].push(removed); if (table === 'pointages') sortPointages(); changed(); throw e; }
  }
  return removed;
}

const strip = (r) => { const { id, _t, _d, created_at, ...rest } = r; return rest; };

// ---------- API métier ----------
export const addPointage = (type, date = new Date()) =>
  insertRow('pointages', { user_id: state.user.id, type_action: type, timestamp: date.toISOString() });
export const updatePointage = (id, date) => updateRow('pointages', id, { timestamp: date.toISOString() });
export const deletePointage = (id) => deleteRow('pointages', id);
export const restorePointage = (row) => insertRow('pointages', { ...strip(row), user_id: state.user.id });

export function saveAbsence(payload, id = null) {
  const row = { user_id: state.user.id, ...payload };
  return id ? updateRow('absences', id, row) : insertRow('absences', row);
}
export const deleteAbsence = (id) => deleteRow('absences', id);
export const restoreAbsence = (row) => insertRow('absences', { ...strip(row), user_id: state.user.id });

export async function saveParams(p) {
  const clean = { ...pick({ ...state.params, ...p }), user_id: state.user.id };
  const { user_id, ...local } = clean;
  state.params = { ...DEFAULT_PARAMS, ...local };
  changed();
  try { await q(supa.from('parametres').upsert(clean)); } catch (e) {
    if (!isNetErr(e)) throw e;
    // Hors-ligne : on rejouera l'enregistrement à la prochaine synchro
    state.queue = state.queue.filter((o) => o.table !== 'parametres');
    enqueue({ table: 'parametres', kind: 'upsert', data: clean });
  }
}
/** Insertion en masse (import / restauration). */
export async function bulkInsert(table, rows, onProgress) {
  const uid = state.user.id, size = 500;
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size).map((r) => ({ ...strip(r), user_id: uid }));
    await q(supa.from(table).insert(chunk));
    onProgress?.(Math.min(rows.length, i + size), rows.length);
  }
}
/** Suppression de toutes les lignes de l'utilisateur dans une table. */
export async function bulkDeleteAll(table) {
  await q(supa.from(table).delete().eq('user_id', state.user.id));
}

// ---------- Sauvegardes cloud (table optionnelle « sauvegardes ») ----------
const missingTable = (e) => ['PGRST205', '42P01', 'PGRST202'].includes(e.code) || /does not exist|could not find the table/i.test(e.message || '');
export const cloud = {
  async list() {
    try {
      const { data } = await q(supa.from('sauvegardes').select('id, created_at, kind, label, counts').eq('user_id', state.user.id).order('created_at', { ascending: false }).limit(60));
      state.cloudBackups = true; return data;
    } catch (e) { if (missingTable(e)) { state.cloudBackups = false; return null; } throw e; }
  },
  async get(id) { const { data } = await q(supa.from('sauvegardes').select('payload').eq('id', id).single()); return data.payload; },
  async save(payload, kind = 'manuelle', label = '') {
    try {
      await q(supa.from('sauvegardes').insert({ user_id: state.user.id, kind, label, counts: payload.counts, payload }));
      state.cloudBackups = true; return true;
    } catch (e) { if (missingTable(e)) { state.cloudBackups = false; return false; } throw e; }
  },
  async remove(id) { await q(supa.from('sauvegardes').delete().eq('id', id)); },
  async prune(keep) {
    const { data } = await q(supa.from('sauvegardes').select('id').eq('user_id', state.user.id).eq('kind', 'auto').order('created_at', { ascending: false }));
    const old = (data || []).slice(keep).map((r) => r.id);
    if (old.length) await q(supa.from('sauvegardes').delete().in('id', old));
  },
};

window.addEventListener('online', () => { state.online = true; emit('sync'); sync(); });
window.addEventListener('offline', () => { state.online = false; emit('sync'); });
export { emit, changed };
