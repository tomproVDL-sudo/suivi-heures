// Composants d'interface partagés : notifications, confirmations, dialogues.
import { $, esc } from './util.js';

export function toast(msg, { error = false, action = null, actionLabel = 'Annuler', duration = 4500 } = {}) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast${error ? ' error' : ''}`;
  el.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.textContent = actionLabel;
    b.onclick = () => { el.remove(); action(); };
    el.appendChild(b);
  }
  box.appendChild(el);
  setTimeout(() => el.remove(), action ? Math.max(duration, 7000) : duration);
  while (box.children.length > 3) box.firstElementChild.remove();
}

export function confirmDialog({ title = 'Confirmer', body = '', okLabel = 'Confirmer', danger = false } = {}) {
  const dlg = $('#dlg-confirm');
  $('#confirm-title').textContent = title;
  $('#confirm-body').innerHTML = body;
  const ok = $('#confirm-ok');
  ok.textContent = okLabel;
  ok.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
  });
}

export const openDialog = (id) => { const d = $(id); if (!d.open) d.showModal(); return d; };
export const closeDialog = (id) => { const d = $(id); if (d.open) d.close(); };

// Fermeture via [data-close] et clic sur le fond
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-close]');
  if (btn) { btn.closest('dialog')?.close(); return; }
  if (e.target.tagName === 'DIALOG') {
    const r = e.target.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) e.target.close();
  }
});

/** Bouton occupé pendant une action asynchrone. */
export async function busy(btn, fn) {
  if (!btn) return fn();
  const html = btn.innerHTML; btn.disabled = true;
  btn.innerHTML = '<span class="spinner sm"></span>';
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = html; }
}

export function errMsg(e) {
  const m = e?.message || String(e);
  if (/permission denied/i.test(m)) return 'Droits manquants dans Supabase (permission denied).';
  if (/row-level security/i.test(m)) return 'Accès refusé par Supabase (règles RLS).';
  if (/JWT|token/i.test(m)) return 'Session expirée : reconnectez-vous.';
  return m;
}
