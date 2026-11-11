// Point d'entrée : démarrage, connexion, navigation, rafraîchissements.
import { $, $$ } from './util.js';
import * as store from './store.js';
import { icon } from './icons.js';
import { toast, errMsg } from './ui.js';
import './dialogs.js';
import * as pointage from './views/pointage.js';
import * as planning from './views/planning.js';
import * as stats from './views/stats.js';
import * as donnees from './views/donnees.js';
import * as reglages from './views/reglages.js';
import { runAutoBackups } from './backup.js';

const VIEWS = {
  pointage: { mod: pointage, icon: 'clock', label: 'Pointage' },
  planning: { mod: planning, icon: 'calendar', label: 'Planning' },
  stats: { mod: stats, icon: 'chart', label: 'Statistiques' },
  donnees: { mod: donnees, icon: 'database', label: 'Données' },
  reglages: { mod: reglages, icon: 'settings', label: 'Réglages' },
};
let current = null;

// ---------- Thème ----------
const mq = window.matchMedia('(prefers-color-scheme: dark)');
export function applyTheme() {
  const t = store.state.prefs.theme || 'auto';
  const dark = t === 'dark' || (t === 'auto' && mq.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  // Barre d'état et de navigation Android de la couleur des encarts (blanc / noir)
  document.getElementById('meta-theme')?.setAttribute('content', dark ? '#111827' : '#ffffff');
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}
mq.addEventListener?.('change', () => { applyTheme(); scheduleRender(); });

// ---------- Navigation ----------
function buildNav() {
  const html = Object.entries(VIEWS).map(([id, v]) => `<a class="nav-item" href="#${id}" data-tab="${id}">${icon(v.icon)}<span>${v.label}</span></a>`).join('');
  $('#nav-side').innerHTML = html;
  $('#nav-bottom').innerHTML = html;
}

function show(tab) {
  if (!VIEWS[tab]) tab = 'pointage';
  current = tab;
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${tab}`));
  $$('[data-tab]').forEach((a) => (a.dataset.tab === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  renderCurrent(true);
  window.scrollTo({ top: 0 });
}

function renderTopbar() {
  const m = VIEWS[current].mod.meta || {};
  $('#page-title').textContent = m.title || VIEWS[current].label;
  $('#page-sub').textContent = typeof m.sub === 'function' ? m.sub() : (m.sub || '');
  $('#page-actions').innerHTML = `${m.actions ? m.actions() : ''}<button class="sync-pill" id="sync-pill" title="Synchroniser maintenant"><span class="dot"></span><span id="sync-text"></span></button>`;
  m.bind?.();
  $('#sync-pill').addEventListener('click', () => store.sync().then((ok) => !ok && store.state.lastError && toast(store.state.lastError, { error: true })));
  updateSyncPill();
}

function renderCurrent(force = false) {
  if (!current) return;
  const view = $(`#view-${current}`);
  // Ne pas écraser un formulaire en cours de saisie
  const a = document.activeElement;
  if (!force && a && view.contains(a) && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) return;
  renderTopbar();
  try { VIEWS[current].mod.render(view); } catch (e) { console.error(e); view.innerHTML = `<div class="notice danger">Erreur d'affichage : ${e.message}</div>`; }
}

let raf = 0;
function scheduleRender() {
  if (current && VIEWS[current].mod.meta?.static) { updateSyncPill(); return; } // vues de formulaires : pas de re-rendu automatique
  cancelAnimationFrame(raf); raf = requestAnimationFrame(() => renderCurrent());
}

function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return `le ${new Date(t).toLocaleDateString('fr-FR')}`;
}
function updateSyncPill() {
  const pill = $('#sync-pill'); if (!pill) return;
  const st = store.state, q = st.queue.length;
  let cls = '', txt;
  if (st.syncing) { cls = 'busy'; txt = 'Synchronisation…'; }
  else if (!navigator.onLine) { cls = 'offline'; txt = `Hors-ligne${q ? ` · ${q} en attente` : ''}`; }
  else if (st.lastError) { cls = 'error'; txt = 'Erreur de synchro'; }
  else if (q) { cls = 'offline'; txt = `${q} modification(s) en attente`; }
  else txt = st.meta.lastSync ? `Synchronisé ${ago(st.meta.lastSync)}` : 'Non synchronisé';
  pill.className = `sync-pill ${cls}`;
  $('#sync-text').textContent = txt;
  if (st.lastError) pill.title = st.lastError;
}

store.onChange((kind) => {
  if (kind === 'sync') updateSyncPill();
  else if (kind === 'prefs') {
    applyTheme();
    if (current === 'reglages') $$('#theme-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === (store.state.prefs.theme || 'auto'))));
    else scheduleRender();
  } else scheduleRender();
});

// ---------- Démarrage ----------
function hideSplash() { $('#splash').hidden = true; }

function showLogin() {
  hideSplash();
  $('#app').hidden = true;
  $('#auth').hidden = false;
  $('#email').focus();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#login-btn'); btn.disabled = true; $('#login-error').textContent = '';
  try {
    const user = await store.login($('#email').value.trim(), $('#password').value);
    await startApp(user);
  } catch (err) { $('#login-error').textContent = errMsg(err); } finally { btn.disabled = false; }
});

let started = false;
async function startApp(user) {
  const name = user.email.split('@')[0];
  $('#avatar').textContent = name.slice(0, 2).toUpperCase();
  $('#user-name').textContent = name;
  $('#user-email').textContent = user.email;
  $('#auth').hidden = true;
  const hasCache = await store.openSession(user);
  $('#app').hidden = false;
  if (hasCache) hideSplash();
  show(location.hash.slice(1));
  const ok = await store.sync();
  hideSplash();
  if (!ok && store.state.lastError && !hasCache) toast(`Synchronisation impossible : ${store.state.lastError}`, { error: true });
  if (ok) runAutoBackups().catch((e) => console.warn('Sauvegarde auto', e));
  if (!started) {
    started = true;
    setInterval(() => { if (current === 'pointage') pointage.tick(Date.now()); }, 1000);
    setInterval(() => {
      if (current === 'planning') planning.tick();
      updateSyncPill();
      const last = store.state.meta.lastSync || 0;
      if (navigator.onLine && !store.state.syncing && Date.now() - last > 5 * 60000) store.sync();
    }, 60000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && navigator.onLine && Date.now() - (store.state.meta.lastSync || 0) > 60000) store.sync();
    });
  }
}

window.addEventListener('hashchange', () => store.state.user && show(location.hash.slice(1)));

function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Une nouvelle version est disponible.', { action: () => w.postMessage('skipWaiting'), actionLabel: 'Mettre à jour', duration: 20000 });
        }
      });
    });
  }).catch((e) => console.warn('SW', e));
  // Rechargement seulement lors d'une mise à jour (pas à la toute première installation)
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloading) { reloading = true; location.reload(); } });
}

async function boot() {
  applyTheme();
  buildNav();
  registerSW();
  let user = null;
  try { user = await store.currentUser(); } catch { /* ignore */ }
  if (user) await startApp(user); else showLogin();
}
boot();
