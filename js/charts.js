// Mini-bibliothèque de graphiques SVG (barres, courbes, boîtes à moustaches, carte de chaleur).
// Légère, sans dépendance, compatible thème sombre et exportable en image (PDF).
import { esc, dayKey, addDays, startOfWeek } from './util.js';

export function theme(forceLight = false) {
  if (forceLight) return { text: '#475569', grid: '#e5e7eb', axis: '#cbd5e1', bg: '#ffffff', empty: '#eef2f6', font: 'Helvetica, Arial, sans-serif' };
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  return { text: v('--muted'), grid: v('--border'), axis: v('--border-strong'), bg: v('--surface'), empty: v('--surface-3'), font: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' };
}

function niceTicks(min, max, count = 5) {
  if (min === max) { max = min + 1; }
  const span = max - min, step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || step0;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { lo, hi, ticks };
}

const legendHtml = (items) => (items.length > 1 ? `<div class="legend">${items.map((s) => `<span><i class="dot-c" style="background:${s.legendColor || (typeof s.color === 'function' ? '#14b8a6' : s.color)}"></i>${esc(s.name)}</span>`).join('')}</div>` : '');

function frame({ width, height, labels, yMin, yMax, yFormat, th, yTitle, xEvery }) {
  const m = { l: 50, r: 12, t: 10, b: 26 };
  const W = width - m.l - m.r, H = height - m.t - m.b;
  const { lo, hi, ticks } = niceTicks(yMin, yMax);
  const y = (v) => m.t + H - ((v - lo) / (hi - lo || 1)) * H;
  const n = labels.length, band = W / Math.max(1, n);
  const x = (i) => m.l + band * i + band / 2;
  let g = '';
  for (const t of ticks) g += `<line x1="${m.l}" x2="${m.l + W}" y1="${y(t)}" y2="${y(t)}" stroke="${th.grid}" stroke-width="1"/><text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="${th.text}">${esc(yFormat(t))}</text>`;
  const every = xEvery || Math.max(1, Math.ceil((n * 44) / W));
  labels.forEach((l, i) => { if (i % every === 0) g += `<text x="${x(i)}" y="${height - 8}" text-anchor="middle" font-size="11" fill="${th.text}">${esc(l)}</text>`; });
  if (lo < 0 && hi > 0) g += `<line x1="${m.l}" x2="${m.l + W}" y1="${y(0)}" y2="${y(0)}" stroke="${th.axis}" stroke-width="1.5"/>`;
  if (yTitle) g += `<text x="12" y="${m.t + H / 2}" transform="rotate(-90 12 ${m.t + H / 2})" text-anchor="middle" font-size="11" fill="${th.text}">${esc(yTitle)}</text>`;
  return { m, W, H, y, x, band, n, g, lo, hi };
}

const wrap = (width, height, inner, th) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${th.font}">${inner}</svg>`;

// ---------- Barres (empilées ou groupées) + courbes de référence ----------
export function buildBar(o) {
  const { labels, series, lines = [], stacked = false, yFormat = (v) => v, width, height = 260, th } = o;
  const n = labels.length;
  let mn = 0, mx = 0;
  for (let i = 0; i < n; i++) {
    if (stacked) {
      let pos = 0, neg = 0; series.forEach((s) => { const v = s.values[i] || 0; if (v >= 0) pos += v; else neg += v; });
      mx = Math.max(mx, pos); mn = Math.min(mn, neg);
    } else series.forEach((s) => { mx = Math.max(mx, s.values[i] || 0); mn = Math.min(mn, s.values[i] || 0); });
    lines.forEach((l) => { if (l.values[i] != null) mx = Math.max(mx, l.values[i]); });
  }
  const f = frame({ width, height, labels, yMin: mn, yMax: mx || 1, yFormat, th, yTitle: o.yTitle });
  let g = f.g;
  const bw = stacked ? Math.min(42, f.band * 0.7) : Math.min(28, (f.band * 0.8) / series.length);
  for (let i = 0; i < n; i++) {
    let pos = 0, neg = 0;
    series.forEach((s, si) => {
      const v = s.values[i] || 0; if (!v) return;
      const color = typeof s.color === 'function' ? s.color(v, i) : s.color;
      let y0, y1, xx;
      if (stacked) { xx = f.x(i) - bw / 2; if (v >= 0) { y0 = f.y(pos); y1 = f.y(pos + v); pos += v; } else { y0 = f.y(neg + v); y1 = f.y(neg); neg += v; } }
      else { xx = f.x(i) - (bw * series.length) / 2 + si * bw; if (v < 0) { y0 = f.y(v); y1 = f.y(0); } else { y0 = f.y(0); y1 = f.y(v); } }
      const top = Math.min(y0, y1), h = Math.max(1, Math.abs(y0 - y1));
      g += `<rect x="${xx.toFixed(1)}" y="${top.toFixed(1)}" width="${Math.max(1, bw - (stacked ? 0 : 2)).toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(4, bw / 4)}" fill="${color}"/>`;
    });
  }
  for (const l of lines) g += pathFor(l.values, f, l.color, l.dash, l.width || 2, true);
  const tip = (i) => ({ title: labels[i], rows: [...series.map((s) => ({ name: s.name, color: typeof s.color === 'function' ? s.color(s.values[i] || 0, i) : s.color, value: s.values[i] })), ...lines.map((l) => ({ name: l.name, color: l.color, value: l.values[i] }))].filter((r) => r.value != null && (r.value !== 0 || series.length < 3)) });
  return { svg: wrap(width, height, g, th), legend: legendHtml([...series, ...lines].filter((s) => s.name)), tip, f };
}

function pathFor(values, f, color, dash, w = 2, step = false) {
  let d = '', open = false;
  values.forEach((v, i) => {
    if (v == null || Number.isNaN(v)) { open = false; return; }
    if (step && f.n > 1) {
      const x0 = f.x(i) - f.band / 2, x1 = f.x(i) + f.band / 2;
      d += `${open ? 'L' : 'M'}${x0.toFixed(1)},${f.y(v).toFixed(1)}L${x1.toFixed(1)},${f.y(v).toFixed(1)}`;
    } else d += `${open ? 'L' : 'M'}${f.x(i).toFixed(1)},${f.y(v).toFixed(1)}`;
    open = true;
  });
  return d ? `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ''} stroke-linejoin="round" stroke-linecap="round"/>` : '';
}

// ---------- Courbes ----------
export function buildLine(o) {
  const { labels, series, yFormat = (v) => v, width, height = 260, th } = o;
  const all = series.flatMap((s) => s.values).filter((v) => v != null && !Number.isNaN(v));
  let mn = o.yMin ?? (all.length ? Math.min(...all) : 0), mx = o.yMax ?? (all.length ? Math.max(...all) : 1);
  if (o.includeZero) { mn = Math.min(0, mn); mx = Math.max(0, mx); }
  if (o.pad) { const p = (mx - mn) * 0.08 || 0.5; mn -= p; mx += p; }
  const f = frame({ width, height, labels, yMin: mn, yMax: mx, yFormat, th, yTitle: o.yTitle });
  let g = f.g;
  for (const s of series) {
    if (s.area) {
      const pts = s.values.map((v, i) => (v == null ? null : [f.x(i), f.y(v)])).filter(Boolean);
      if (pts.length > 1) {
        const base = f.y(Math.max(f.lo, Math.min(0, f.hi)));
        g += `<path d="M${pts[0][0]},${base}L${pts.map((p) => p.join(',')).join('L')}L${pts[pts.length - 1][0]},${base}Z" fill="${s.color}" opacity=".14"/>`;
      }
    }
    g += pathFor(s.values, f, s.color, s.dash, s.width || 2.2);
    if (s.dots !== false && f.n <= 40) s.values.forEach((v, i) => { if (v != null) g += `<circle cx="${f.x(i)}" cy="${f.y(v)}" r="3" fill="${s.color}"/>`; });
  }
  const tip = (i) => ({ title: labels[i], rows: series.map((s) => ({ name: s.name, color: s.color, value: s.values[i] })).filter((r) => r.value != null) });
  return { svg: wrap(width, height, g, th), legend: legendHtml(series.filter((s) => s.name)), tip, f };
}

// ---------- Boîtes à moustaches ----------
const quant = (s, q) => { const p = (s.length - 1) * q, b = Math.floor(p); return s[b + 1] !== undefined ? s[b] + (p - b) * (s[b + 1] - s[b]) : s[b]; };
export function boxStats(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const q1 = quant(s, 0.25), q3 = quant(s, 0.75), med = quant(s, 0.5), iqr = q3 - q1;
  const lo = s.find((v) => v >= q1 - 1.5 * iqr), hi = [...s].reverse().find((v) => v <= q3 + 1.5 * iqr);
  return { min: s[0], max: s[s.length - 1], q1, q3, med, lo, hi, out: s.filter((v) => v < lo || v > hi), n: s.length };
}
export function buildBox(o) {
  const { labels, groups, color, yFormat = (v) => v, width, height = 260, th } = o;
  const stats = groups.map(boxStats);
  const all = groups.flat();
  const f = frame({ width, height, labels, yMin: all.length ? Math.min(...all) : 0, yMax: all.length ? Math.max(...all) : 1, yFormat, th });
  let g = f.g;
  const bw = Math.min(30, f.band * 0.5);
  stats.forEach((st, i) => {
    if (!st) return;
    const cx = f.x(i);
    g += `<line x1="${cx}" x2="${cx}" y1="${f.y(st.hi)}" y2="${f.y(st.q3)}" stroke="${color}" stroke-width="1.5"/><line x1="${cx}" x2="${cx}" y1="${f.y(st.q1)}" y2="${f.y(st.lo)}" stroke="${color}" stroke-width="1.5"/>`;
    g += `<line x1="${cx - bw / 4}" x2="${cx + bw / 4}" y1="${f.y(st.hi)}" y2="${f.y(st.hi)}" stroke="${color}" stroke-width="1.5"/><line x1="${cx - bw / 4}" x2="${cx + bw / 4}" y1="${f.y(st.lo)}" y2="${f.y(st.lo)}" stroke="${color}" stroke-width="1.5"/>`;
    g += `<rect x="${cx - bw / 2}" y="${f.y(st.q3)}" width="${bw}" height="${Math.max(1, f.y(st.q1) - f.y(st.q3))}" rx="3" fill="${color}" fill-opacity=".25" stroke="${color}" stroke-width="1.5"/>`;
    g += `<line x1="${cx - bw / 2}" x2="${cx + bw / 2}" y1="${f.y(st.med)}" y2="${f.y(st.med)}" stroke="${color}" stroke-width="2.5"/>`;
    st.out.slice(0, 40).forEach((v) => { g += `<circle cx="${cx}" cy="${f.y(v)}" r="2.5" fill="#ef4444" opacity=".7"/>`; });
  });
  const tip = (i) => {
    const st = stats[i];
    return { title: labels[i], rows: st ? [['Max', st.max], ['3e quartile', st.q3], ['Médiane', st.med], ['1er quartile', st.q1], ['Min', st.min], ['Jours', null, st.n]].map(([name, v, raw]) => ({ name, value: v ?? raw, raw: raw != null })) : [{ name: 'Pas de données', value: null }] };
  };
  return { svg: wrap(width, height, g, th), legend: '', tip, f };
}

// ---------- Carte de chaleur annuelle ----------
export function buildHeatmap(o) {
  const { start, end, cell: cellFn, th } = o;
  const C = 13, G = 3, top = 18, left = 26;
  const s0 = startOfWeek(start);
  const weeks = Math.ceil(((end - s0) / 86400000 + 1) / 7);
  const width = left + weeks * (C + G), height = top + 7 * (C + G);
  let g = '';
  ['L', '', 'M', '', 'V', '', 'D'].forEach((l, i) => { if (l) g += `<text x="0" y="${top + i * (C + G) + 10}" font-size="10" fill="${th.text}">${l}</text>`; });
  let lastM = -1;
  const cells = [];
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const day = addDays(s0, w * 7 + d);
      if (day < start || day > end) continue;
      if (d === 0 && day.getMonth() !== lastM && day.getDate() <= 7) { lastM = day.getMonth(); g += `<text x="${left + w * (C + G)}" y="11" font-size="10" fill="${th.text}">${day.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '')}</text>`; }
      const c = cellFn(dayKey(day), day);
      cells.push(c);
      g += `<rect x="${left + w * (C + G)}" y="${top + d * (C + G)}" width="${C}" height="${C}" rx="3" fill="${c.color || th.empty}" data-i="${cells.length - 1}"/>`;
    }
  }
  return { svg: wrap(width, height, g, th), cells };
}

// ---------- Montage dans le DOM (tooltip + redimensionnement) ----------
const tipEl = () => document.getElementById('chart-tip');
function showTip(ev, t, fmt) {
  const el = tipEl(); if (!el || !t) return;
  el.innerHTML = `<div class="tt">${esc(t.title)}</div>${t.rows.map((r) => `<div class="tr"><i class="dot-c" style="background:${r.color || 'transparent'}"></i>${esc(r.name)}<b>${r.value == null ? '–' : esc(r.raw ? String(r.value) : fmt(r.value))}</b></div>`).join('')}`;
  el.classList.add('show');
  const w = el.offsetWidth, h = el.offsetHeight;
  let x, y;
  if (ev.pointerType && ev.pointerType !== 'mouse') { x = ev.clientX - w / 2; y = ev.clientY - h - 28; } // au-dessus du doigt
  else { x = ev.clientX + 14; y = ev.clientY - h - 10; if (x + w > innerWidth - 8) x = ev.clientX - w - 14; }
  x = Math.max(8, Math.min(x, innerWidth - w - 8));
  if (y < 8) y = ev.clientY + 28;
  el.style.left = `${x}px`; el.style.top = `${y}px`;
}
const hideTip = () => tipEl()?.classList.remove('show');
let tipTimer = 0;
const hideTipLater = (ms = 3000) => { clearTimeout(tipTimer); tipTimer = setTimeout(hideTip, ms); };
document.addEventListener('pointerdown', (e) => { if (!e.target.closest?.('.chart, .heatmap')) hideTip(); }, true);
window.addEventListener('scroll', () => hideTip(), { passive: true });

const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver((entries) => {
  for (const e of entries) {
    const el = e.target;
    if (el._w && Math.abs(el.clientWidth - el._w) > 4 && el._draw) el._draw();
  }
}) : null;

const hiddenByChart = new Map(); // séries masquées via la légende, mémorisées par graphique
const swatch = (s) => s.legendColor || (typeof s.color === 'function' ? '#14b8a6' : s.color);

/** Monte un graphique : kind = 'bar' | 'line' | 'box'. Légende cliquable pour masquer/afficher une série. */
export function mount(el, kind, opts) {
  const id = el.id || '';
  if (!hiddenByChart.has(id)) hiddenByChart.set(id, new Set());
  const hidden = hiddenByChart.get(id);
  const items = kind === 'box' ? [] : [...(opts.series || []), ...(opts.lines || [])].filter((s) => s.name);
  const draw = () => {
    const width = Math.max(260, el.clientWidth || 600);
    el._w = el.clientWidth;
    const hasData = opts.labels?.length && (kind !== 'box' ? true : opts.groups.some((g) => g.length));
    if (!hasData) { el.innerHTML = '<div class="chart-empty">Pas de données sur la période</div>'; return; }
    const o2 = { ...opts, series: (opts.series || []).filter((s) => !hidden.has(s.name)), lines: (opts.lines || []).filter((s) => !hidden.has(s.name)) };
    const b = (kind === 'bar' ? buildBar : kind === 'line' ? buildLine : buildBox)({ ...o2, width, th: theme() });
    const legend = items.length > 1 ? `<div class="legend">${items.map((s) => `<button type="button" class="lg-item${hidden.has(s.name) ? ' off' : ''}" data-name="${esc(s.name)}" aria-pressed="${!hidden.has(s.name)}" title="Afficher / masquer"><i class="dot-c" style="background:${swatch(s)}"></i>${esc(s.name)}</button>`).join('')}</div>` : '';
    el.innerHTML = `${legend}<div class="chart-svg">${b.svg}</div>`;
    el.querySelectorAll('.lg-item').forEach((btn) => btn.addEventListener('click', () => {
      const n = btn.dataset.name;
      if (hidden.has(n)) hidden.delete(n); else hidden.add(n);
      draw();
    }));
    const svg = el.querySelector('svg');
    const fmt = opts.tipFormat || opts.yFormat || ((v) => v);
    const at = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * width;
      const i = Math.floor((px - b.f.m.l) / b.f.band);
      if (i < 0 || i >= b.f.n) return hideTip();
      showTip(ev, b.tip(i), fmt);
    };
    // Souris : survol. Doigt : poser le doigt affiche l'info, glisser horizontalement la fait suivre.
    svg.addEventListener('pointerdown', (ev) => { if (ev.pointerType !== 'mouse') { clearTimeout(tipTimer); at(ev); } });
    svg.addEventListener('pointermove', at);
    svg.addEventListener('pointerup', (ev) => { if (ev.pointerType !== 'mouse') hideTipLater(); });
    svg.addEventListener('pointercancel', () => hideTipLater());
    svg.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') hideTip(); });
    if (opts.onClick) svg.addEventListener('click', (ev) => {
      const r = svg.getBoundingClientRect();
      const i = Math.floor((((ev.clientX - r.left) / r.width) * width - b.f.m.l) / b.f.band);
      if (i >= 0 && i < b.f.n) opts.onClick(i);
    });
  };
  el._draw = draw;
  draw();
  ro?.observe(el);
}

export function mountHeatmap(el, opts) {
  const b = buildHeatmap({ ...opts, th: theme() });
  el.innerHTML = b.svg;
  const svg = el.querySelector('svg');
  let selected = null;
  const show = (ev) => {
    const i = ev.target.dataset?.i;
    if (i == null) return null;
    const c = b.cells[+i];
    showTip(ev, { title: c.title, rows: c.rows.length ? c.rows : [{ name: 'Aucun pointage', value: '', raw: true }] }, (v) => v);
    return +i;
  };
  svg.addEventListener('pointermove', (ev) => { if (ev.pointerType === 'mouse' && show(ev) == null) hideTip(); });
  svg.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') hideTip(); });
  svg.addEventListener('click', (ev) => {
    const i = ev.target.dataset?.i;
    if (i == null) return;
    // Au doigt : 1er appui = affiche les heures, 2e appui sur la même case = ouvre la journée
    if (selected !== +i && matchMedia('(pointer: coarse)').matches) {
      svg.querySelector('rect.sel')?.classList.remove('sel');
      ev.target.classList.add('sel');
      selected = show(ev);
      hideTipLater(4000);
      return;
    }
    hideTip();
    if (opts.onClick) opts.onClick(b.cells[+i].key);
  });
}

/** Convertit un SVG (chaîne) en PNG (data URL) pour l'export PDF. */
export function svgToPng(svg, width, height, scale = 2) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = width * scale; c.height = height * scale;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}
