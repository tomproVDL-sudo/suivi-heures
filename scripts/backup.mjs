// Sauvegarde hors-site exécutée par GitHub Actions (voir .github/workflows/sauvegarde.yml).
// Se connecte AVEC VOTRE COMPTE (pas de clé admin) : les règles RLS s'appliquent.
// Produit un fichier au même format que le bouton « Télécharger une sauvegarde » de l'application.
import { createHash } from 'node:crypto';
import { writeFileSync, readFileSync } from 'node:fs';

const cfg = readFileSync(new URL('../js/config.js', import.meta.url), 'utf8');
const URL_ = process.env.SUPABASE_URL || cfg.match(/SUPABASE_URL = '([^']+)'/)[1];
const KEY = process.env.SUPABASE_ANON_KEY || cfg.match(/SUPABASE_ANON_KEY = '([^']+)'/)[1];
const { BACKUP_EMAIL: email, BACKUP_PASSWORD: password } = process.env;
if (!email || !password) { console.error('Secrets BACKUP_EMAIL et BACKUP_PASSWORD manquants.'); process.exit(1); }

const auth = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
});
if (!auth.ok) { console.error('Connexion refusée :', auth.status, await auth.text()); process.exit(1); }
const { access_token: token, user } = await auth.json();
const H = { apikey: KEY, Authorization: `Bearer ${token}` };

async function all(table, order) {
  const out = []; const size = 1000;
  for (let from = 0; ; from += size) {
    const r = await fetch(`${URL_}/rest/v1/${table}?select=*&user_id=eq.${user.id}&order=${order}`, { headers: { ...H, Range: `${from}-${from + size - 1}`, 'Range-Unit': 'items' } });
    if (!r.ok) throw new Error(`${table} : ${r.status} ${await r.text()}`);
    const rows = await r.json(); out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}

const [params] = await all('parametres', 'user_id.asc');
const pointages = await all('pointages', 'timestamp.asc,id.asc');
const absences = await all('absences', 'date_debut.asc,id.asc');
const { user_id, ...parametres } = params || {};
const data = { parametres, pointages, absences };
const payload = {
  app: 'suivi-heures', format: 2, version: 'github-action', created_at: new Date().toISOString(), user: email,
  counts: { pointages: pointages.length, absences: absences.length },
  range: { from: pointages[0]?.timestamp || null, to: pointages.at(-1)?.timestamp || null },
  prefs: {}, data,
  checksum: createHash('sha256').update(JSON.stringify(data)).digest('hex'),
};
writeFileSync(process.argv[2] || 'sauvegarde.json', JSON.stringify(payload));
console.log(`OK : ${pointages.length} pointages, ${absences.length} absences.`);
