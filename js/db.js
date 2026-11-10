// Petit wrapper IndexedDB (cache des données + sauvegardes locales).
// Repli en mémoire si IndexedDB est indisponible (navigation privée ancienne).

let dbPromise = null;
const memory = { kv: new Map(), backups: new Map(), seq: 1 };
let useMemory = false;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open('suivi-heures', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
          if (!db.objectStoreNames.contains('backups')) db.createObjectStore('backups', { keyPath: 'id', autoIncrement: true });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => { useMemory = true; resolve(null); };
      } catch { useMemory = true; resolve(null); }
    });
  }
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  if (!db || useMemory) return null;
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const kv = {
  async get(k) { await open(); return useMemory ? memory.kv.get(k) : run('kv', 'readonly', (s) => s.get(k)); },
  async set(k, v) { await open(); if (useMemory) memory.kv.set(k, v); else await run('kv', 'readwrite', (s) => s.put(v, k)); },
  async del(k) { await open(); if (useMemory) memory.kv.delete(k); else await run('kv', 'readwrite', (s) => s.delete(k)); },
};

export const localBackups = {
  async add(rec) {
    await open();
    if (useMemory) { const id = memory.seq++; memory.backups.set(id, { ...rec, id }); return id; }
    return run('backups', 'readwrite', (s) => s.add(rec));
  },
  /** Liste (sans le contenu, trié du plus récent au plus ancien). */
  async list(uid) {
    await open();
    const all = useMemory ? [...memory.backups.values()] : await run('backups', 'readonly', (s) => s.getAll());
    return (all || []).filter((b) => b.uid === uid).map(({ payload, ...meta }) => meta)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  },
  async get(id) { await open(); return useMemory ? memory.backups.get(id) : run('backups', 'readonly', (s) => s.get(id)); },
  async del(id) { await open(); if (useMemory) memory.backups.delete(id); else await run('backups', 'readwrite', (s) => s.delete(id)); },
};
