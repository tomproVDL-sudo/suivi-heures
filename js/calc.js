// Moteur de calcul PUR (aucun accès DOM / réseau) : testable avec Node.
import {
  HOUR, MIN, DAY, dayKey, monthKey, weekKey, parseDay, addDays, eachDay, isWeekend,
  startOfWeek, hoursOfDay, isoWeek, pad,
} from './util.js';

export const ABSENCE_TYPES = {
  RTT: { label: 'RTT', color: '#3b82f6' },
  CP: { label: 'Congé payé', color: '#14b8a6' },
  CET: { label: 'CET', color: '#8b5cf6' },
  AEA: { label: 'Autorisation except. (AEA)', color: '#06b6d4' },
  Formation: { label: 'Formation', color: '#84cc16' },
  Maladie: { label: 'Arrêt maladie', color: '#ef4444' },
};
export const FERIE_COLOR = '#94a3b8';
export const absColor = (t) => ABSENCE_TYPES[t]?.color || '#64748b';
export const isHalf = (a) => a.moment === 'matin' || a.moment === 'aprem';
export const momentLabel = (m) => ({ matin: 'Matin', aprem: 'Après-midi', journee: 'Journée' }[m] || m || 'Journée');

export const DEFAULT_PARAMS = {
  cp_initial: 25, rtt_initial: 15, base_horaire: 39, limite_heures_jour: 10, notifs_actives: false,
  objectif_annuel: 1607, reliquat_cp: 0, date_limite_reliquat: '', cet_initial: 0, recup_initial: 0,
  don_jours: 0, annee_maj: null,
};
export const DEFAULT_PREFS = {
  theme: 'auto',
  basesHistoriques: [{ jusqua: '2021-12-31', heures: 35 }],
  pauseRefMin: 45,
  seuilOrangeMin: 528, // 8h48
  seuilRougeMin: 600, // 10h00
  counterOrder: null,
  hiddenCounters: ['recup', 'aea', 'formation', 'don'],
  autoBackupLocal: true,
  autoBackupCloud: true,
};

// ---------- Jours fériés (calcul local, identique à l'API calendrier.api.gouv.fr « métropole ») ----------
export function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}
export function feriesAnnee(y) {
  const e = easter(y);
  return {
    [`${y}-01-01`]: '1er janvier', [dayKey(addDays(e, 1))]: 'Lundi de Pâques', [`${y}-05-01`]: '1er mai',
    [`${y}-05-08`]: '8 mai', [dayKey(addDays(e, 39))]: 'Ascension', [dayKey(addDays(e, 50))]: 'Lundi de Pentecôte',
    [`${y}-07-14`]: '14 juillet', [`${y}-08-15`]: 'Assomption', [`${y}-11-01`]: 'Toussaint',
    [`${y}-11-11`]: '11 novembre', [`${y}-12-25`]: 'Jour de Noël',
  };
}

const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

/** Prépare un pointage brut Supabase (ajoute _t = epoch ms, _d = jour local). */
export function prepPointage(p) {
  const t = Date.parse(p.timestamp);
  return { ...p, _t: t, _d: dayKey(new Date(t)) };
}

export class Engine {
  constructor({ pointages = [], absences = [], params = {}, prefs = {} } = {}) {
    this.params = { ...DEFAULT_PARAMS, ...params };
    this.prefs = { ...DEFAULT_PREFS, ...prefs };
    this.byDay = new Map();
    for (const p of pointages) {
      if (!this.byDay.has(p._d)) this.byDay.set(p._d, []);
      this.byDay.get(p._d).push(p);
    }
    for (const list of this.byDay.values()) list.sort((a, b) => a._t - b._t);
    this.absences = absences;
    this.absByDay = new Map();
    for (const a of absences) {
      if (!a.date_debut) continue;
      const s = parseDay(a.date_debut), e = parseDay(a.date_fin || a.date_debut);
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s || (e - s) / DAY > 400) continue;
      for (const d of eachDay(s, e)) {
        const k = dayKey(d);
        if (!this.absByDay.has(k)) this.absByDay.set(k, []);
        this.absByDay.get(k).push(a);
      }
    }
    this._feries = new Map();
    this._sum = new Map();
    this._hist = [...(this.prefs.basesHistoriques || [])].filter((h) => h && h.jusqua && +h.heures > 0)
      .sort((a, b) => (a.jusqua < b.jusqua ? -1 : 1));
  }

  // ----- Calendrier -----
  feries(y) { if (!this._feries.has(y)) this._feries.set(y, feriesAnnee(y)); return this._feries.get(y); }
  ferie(key) { return this.feries(+key.slice(0, 4))[key] || null; }
  isWorkingDay(d) { return !isWeekend(d) && !this.ferie(dayKey(d)); }
  baseHebdo(key) { for (const h of this._hist) if (key <= h.jusqua) return +h.heures; return +this.params.base_horaire || 39; }
  hpdMs(key) { return (this.baseHebdo(key) / 5) * HOUR; }
  points(key) { return this.byDay.get(key) || []; }
  absencesOn(key) { return this.absByDay.get(key) || []; }

  // ----- Journée -----
  summary(key, now = Date.now()) {
    const live = key === dayKey(new Date(now));
    if (!live && this._sum.has(key)) return this._sum.get(key);
    const pts = this.points(key);
    let work = 0, pause = 0, nbPauses = 0, lastArr = null, pStart = null, first = null, last = null, lastAction = null;
    const segments = [], pauseStarts = [], pauseEnds = [];
    for (const p of pts) {
      const t = p._t; lastAction = p.type_action;
      if (p.type_action === 'arrivee') {
        if (pStart != null) { pause += t - pStart; nbPauses++; pauseEnds.push(t); segments.push({ type: 'pause', s: pStart, e: t }); pStart = null; }
        if (lastArr == null) lastArr = t;
        if (first == null) first = t;
      } else if (p.type_action === 'pause') {
        if (lastArr != null) { work += t - lastArr; segments.push({ type: 'work', s: lastArr, e: t }); lastArr = null; }
        if (pStart == null) { pStart = t; pauseStarts.push(t); }
      } else if (p.type_action === 'depart') {
        if (pStart != null) { pause += t - pStart; nbPauses++; pauseEnds.push(t); segments.push({ type: 'pause', s: pStart, e: t }); pStart = null; }
        if (lastArr != null) { work += t - lastArr; segments.push({ type: 'work', s: lastArr, e: t }); lastArr = null; }
        last = t;
      }
    }
    let status = 'none';
    if (lastAction === 'arrivee') status = 'work';
    else if (lastAction === 'pause') status = 'pause';
    else if (lastAction === 'depart') status = 'done';
    if (live && lastArr != null && now > lastArr) { work += now - lastArr; segments.push({ type: 'work', s: lastArr, e: now, live: true }); }
    if (live && pStart != null && now > pStart) { pause += now - pStart; segments.push({ type: 'pause', s: pStart, e: now, live: true }); }
    const end = last ?? (live && (lastArr != null || pStart != null) ? now : null);
    const res = {
      key, n: pts.length, work, pause, nbPauses, first, last, lastAction, status, segments, pauseStarts, pauseEnds,
      amplitude: first != null && end != null ? end - first : 0, live, openArrival: lastArr, openPause: pStart,
    };
    if (!live) this._sum.set(key, res);
    return res;
  }

  /** Temps attendu et crédit (formation) pour une journée. */
  dayPlan(key) {
    const d = parseDay(key);
    const abs = this.absencesOn(key);
    const ferie = this.ferie(key), we = isWeekend(d);
    if (we || ferie) return { expected: 0, credit: 0, off: 0, abs, ferie, we };
    const hpd = this.hpdMs(key);
    let off = 0, credit = 0;
    for (const a of abs) {
      const frac = isHalf(a) ? 0.5 : 1;
      if (a.type_absence === 'Formation') credit += frac * hpd; else off += frac;
    }
    off = Math.min(1, off);
    return { expected: hpd * (1 - off), credit: Math.min(credit, hpd * (1 - off)), off, abs, ferie, we };
  }

  /** Réel (travail + crédit formation) et attendu, cumulés de start à end inclus. */
  range(start, end, now = Date.now()) {
    let real = 0, expected = 0;
    for (const d of eachDay(start, end)) {
      const k = dayKey(d), plan = this.dayPlan(k);
      real += this.summary(k, now).work + plan.credit;
      expected += plan.expected;
    }
    return { real, expected, delta: real - expected };
  }

  /** Nombre de jours ouvrés décomptés par une absence (optionnellement bornée). */
  absenceDays(a, from = null, to = null, filter = null) {
    let s = parseDay(a.date_debut), e = parseDay(a.date_fin || a.date_debut);
    if (from && s < from) s = new Date(from);
    if (to && e > to) e = new Date(to);
    if (e < s || (e - s) / DAY > 400) return 0;
    const frac = isHalf(a) ? 0.5 : 1;
    let n = 0;
    for (const d of eachDay(s, e)) if (this.isWorkingDay(d) && (!filter || filter(d))) n += frac;
    return n;
  }

  // ----- Soldes de l'année -----
  soldes(year, now = Date.now()) {
    const P = this.params;
    const y0 = new Date(year, 0, 1), y1 = new Date(year, 11, 31);
    const cons = { CP: 0, RTT: 0, CET: 0, AEA: 0, Formation: 0, Maladie: 0 };
    let cpAvantLimite = 0, fractionnement = 0;
    const limite = P.date_limite_reliquat ? parseDay(P.date_limite_reliquat) : null;
    for (const a of this.absences) {
      const n = this.absenceDays(a, y0, y1);
      if (!n) continue;
      if (cons[a.type_absence] !== undefined) cons[a.type_absence] += n;
      if (a.type_absence === 'CP') {
        fractionnement += this.absenceDays(a, y0, y1, (d) => d.getMonth() <= 3 || d.getMonth() >= 10);
        cpAvantLimite += limite ? this.absenceDays(a, y0, limite) : n;
      }
    }
    const reliquat = +P.reliquat_cp || 0;
    const expire = limite ? now > limite.getTime() + DAY - 1 : false;
    const prisSurReliquat = Math.min(reliquat, cpAvantLimite);
    const reliquatRestant = expire ? 0 : reliquat - prisSurReliquat;
    const cpRestants = (+P.cp_initial || 0) - (cons.CP - prisSurReliquat);
    const jFrac = fractionnement >= 8 ? 2 : fractionnement >= 5 ? 1 : 0;

    const { possibles: pontsPossibles, poses: pontsPoses } = this.ponts(y0, y1);
    const rttRestants = (+P.rtt_initial || 0) - cons.RTT;
    const nowD = new Date(now);
    return {
      year, cons, reliquat, reliquatRestant, reliquatExpire: expire, cpRestants, fractionnement, jFrac,
      rttRestants, rttAlerte: rttRestants > 0 && nowD.getFullYear() === year && nowD.getMonth() >= 9,
      cetRestants: (+P.cet_initial || 0) - cons.CET, recup: +P.recup_initial || 0, don: +P.don_jours || 0,
      pontsPossibles, pontsPoses,
    };
  }

  /** Ponts d'un jour (lundi avant mardi férié, vendredi après jeudi férié) sur une période. */
  ponts(start, end) {
    let possibles = 0, poses = 0;
    for (const d of eachDay(start, end)) {
      const wd = d.getDay();
      if ((wd !== 1 && wd !== 5) || !this.isWorkingDay(d)) continue;
      if (!this.ferie(dayKey(addDays(d, wd === 1 ? 1 : -1)))) continue;
      possibles++;
      const off = this.absencesOn(dayKey(d)).filter((a) => a.type_absence !== 'Maladie' && a.type_absence !== 'Formation')
        .reduce((s, a) => s + (isHalf(a) ? 0.5 : 1), 0);
      if (off >= 1) poses++;
    }
    return { possibles, poses };
  }

  // ----- Heures sup -----
  overtime(now = Date.now()) {
    const t = new Date(now); t.setHours(0, 0, 0, 0);
    return {
      week: this.range(startOfWeek(t), t, now),
      month: this.range(new Date(t.getFullYear(), t.getMonth(), 1), t, now),
      year: this.range(new Date(t.getFullYear(), 0, 1), t, now),
    };
  }

  /** Objectif annuel (1607 h) : cumul, date d'atteinte ou projection. */
  objectif(now = Date.now()) {
    const obj = (+this.params.objectif_annuel || 1607) * HOUR;
    const t = new Date(now); t.setHours(0, 0, 0, 0);
    const y = t.getFullYear();
    let cumul = 0, atteint = null, joursOuvres = 0;
    for (const d of eachDay(new Date(y, 0, 1), t)) {
      const k = dayKey(d);
      cumul += this.summary(k, now).work + this.dayPlan(k).credit;
      if (this.isWorkingDay(d)) joursOuvres++;
      if (!atteint && cumul >= obj) atteint = k;
    }
    let projection = null;
    if (!atteint && joursOuvres > 10 && cumul > 0) {
      const parJour = cumul / joursOuvres;
      let reste = obj - cumul, d = addDays(t, 1);
      for (let i = 0; i < 730 && reste > 0; i++, d = addDays(d, 1)) if (this.isWorkingDay(d)) reste -= parJour;
      if (reste <= 0) projection = dayKey(addDays(d, -1));
    }
    return { objectif: obj, cumul, atteint, reste: Math.max(0, obj - cumul), projection, progression: Math.min(1, cumul / obj) };
  }

  /** Couleur de la bulle d'une journée selon les seuils. */
  dayLevel(workMs, key) {
    const min = Math.round(workMs / MIN);
    const req = Math.round(this.hpdMs(key) / MIN);
    if (min > this.prefs.seuilRougeMin) return 'red';
    if (min >= this.prefs.seuilOrangeMin) return 'orange';
    if (min < req) return 'blue';
    return 'green';
  }

  // ----- Statistiques d'une période -----
  stats(start, end, now = Date.now()) {
    const todayD = new Date(now); todayD.setHours(0, 0, 0, 0);
    const days = [], months = new Map(), weeks = new Map();
    const weekday = Array.from({ length: 7 }, () => ({ total: 0, n: 0 }));
    const dist = { arrivee: [], depart: [], pause_debut: [], pause_fin: [], duree_travail: [] };
    const absTotals = {}; let feriesCount = 0;
    const comp = { over10: [], shortPause: [], shortRest: [], over48: [] };
    const cumul = [];
    let running = 0, prevLast = null, prevKey = null;

    const mOf = (d) => {
      const k = monthKey(d);
      if (!months.has(k)) months.set(k, { key: k, label: d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }), work: 0, expected: 0, real: 0, workedDays: 0, arr: [], dep: [], ps: [], pe: [], pauseMs: 0, nbPauses: 0, abs: {}, feries: 0 });
      return months.get(k);
    };
    const wOf = (d) => {
      const k = weekKey(d);
      if (!weeks.has(k)) { const w = isoWeek(d); weeks.set(k, { key: k, label: `S${pad(w.week)}`, start: dayKey(startOfWeek(d)), work: 0, expected: 0, real: 0 }); }
      return weeks.get(k);
    };

    for (const d of eachDay(start, end)) {
      const k = dayKey(d), s = this.summary(k, now), plan = this.dayPlan(k), m = mOf(d), w = wOf(d);
      const past = d <= todayD;
      const real = s.work + plan.credit;
      const row = { key: k, date: d, work: s.work, pause: s.pause, nbPauses: s.nbPauses, first: s.first, last: s.last, amplitude: s.amplitude, expected: plan.expected, credit: plan.credit, real, abs: plan.abs, ferie: plan.ferie, we: plan.we, past, pauseStarts: s.pauseStarts, pauseEnds: s.pauseEnds };
      days.push(row);
      if (plan.ferie && !plan.we) { feriesCount++; m.feries++; }
      for (const a of plan.abs) {
        if (plan.we || plan.ferie) continue;
        const v = isHalf(a) ? 0.5 : 1;
        absTotals[a.type_absence] = (absTotals[a.type_absence] || 0) + v;
        m.abs[a.type_absence] = (m.abs[a.type_absence] || 0) + v;
      }
      if (past) {
        m.expected += plan.expected; w.expected += plan.expected;
        m.real += real; w.real += real;
        running += real - plan.expected;
        cumul.push({ key: k, value: running / HOUR });
      }
      m.work += s.work; w.work += s.work;
      if (s.work > 0) {
        m.workedDays++;
        weekday[d.getDay()].total += s.work; weekday[d.getDay()].n++;
        dist.duree_travail.push({ m: m.key, v: s.work / HOUR });
        if (s.work > 10 * HOUR) comp.over10.push(k);
        if (s.work > 6 * HOUR && s.pause < 20 * MIN) comp.shortPause.push(k);
      }
      if (s.first != null) { const v = hoursOfDay(s.first); m.arr.push(v); dist.arrivee.push({ m: m.key, v }); }
      if (s.last != null) { const v = hoursOfDay(s.last); m.dep.push(v); dist.depart.push({ m: m.key, v }); }
      s.pauseStarts.forEach((t, i) => { const v = hoursOfDay(t); dist.pause_debut.push({ m: m.key, v }); if (i === 0) m.ps.push(v); });
      s.pauseEnds.forEach((t, i) => { const v = hoursOfDay(t); dist.pause_fin.push({ m: m.key, v }); if (i === s.pauseEnds.length - 1) m.pe.push(v); });
      m.pauseMs += s.pause; m.nbPauses += s.nbPauses;
      // Repos quotidien entre deux journées consécutives
      if (s.first != null && prevLast != null && prevKey === dayKey(addDays(d, -1))) {
        const rest = s.first - prevLast;
        if (rest < 11 * HOUR) comp.shortRest.push({ key: k, ms: rest });
      }
      if (s.last != null) { prevLast = s.last; prevKey = k; } else if (s.n === 0) { prevLast = null; prevKey = null; }
    }
    for (const w of weeks.values()) if (w.work > 48 * HOUR) comp.over48.push({ key: w.key, label: w.label, start: w.start, ms: w.work });

    const worked = days.filter((r) => r.work > 0);
    const total = worked.reduce((s, r) => s + r.work, 0);
    const past = days.filter((r) => r.past);
    const expected = past.reduce((s, r) => s + r.expected, 0);
    const real = past.reduce((s, r) => s + r.real, 0);
    const arr = worked.filter((r) => r.first != null).map((r) => hoursOfDay(r.first));
    const dep = worked.filter((r) => r.last != null).map((r) => hoursOfDay(r.last));
    const withPause = worked.filter((r) => r.pause > 0);
    const longest = worked.reduce((b, r) => (!b || r.work > b.work ? r : b), null);
    const amps = worked.filter((r) => r.amplitude > 0).map((r) => r.amplitude);

    return {
      start, end, days,
      months: [...months.values()].map((m) => ({ ...m, balance: m.real - m.expected, arrAvg: mean(m.arr), depAvg: mean(m.dep), psAvg: mean(m.ps), peAvg: mean(m.pe), pauseAvgMin: m.nbPauses ? m.pauseMs / m.nbPauses / MIN : 0 })),
      weeks: [...weeks.values()].map((w) => ({ ...w, balance: w.real - w.expected })),
      weekday: [1, 2, 3, 4, 5, 6, 0].map((i) => ({ day: i, avg: weekday[i].n ? weekday[i].total / weekday[i].n : 0, n: weekday[i].n })),
      cumul, dist, absTotals, feriesCount, compliance: comp,
      kpi: {
        total, workedDays: worked.length, avgDay: worked.length ? total / worked.length : 0,
        expected, real, balance: real - expected,
        avgArrival: mean(arr), avgDeparture: mean(dep), medArrival: median(arr), medDeparture: median(dep),
        earliest: arr.length ? Math.min(...arr) : null, latest: dep.length ? Math.max(...dep) : null,
        avgPauseDay: withPause.length ? withPause.reduce((s, r) => s + r.pause, 0) / withPause.length : 0,
        avgAmplitude: mean(amps) || 0, longest: longest ? { key: longest.key, ms: longest.work } : null,
        nbPauses: worked.reduce((s, r) => s + r.nbPauses, 0),
      },
    };
  }
}

/** Calcule le reliquat à reporter lors du passage à une nouvelle année. */
export function rolloverParams(engine, currentYear) {
  const P = engine.params;
  if (!P.annee_maj) return { ...P, annee_maj: currentYear };
  if (+P.annee_maj >= currentYear) return null;
  const s = engine.soldes(+P.annee_maj, new Date(+P.annee_maj, 11, 31, 23).getTime());
  let lim = P.date_limite_reliquat;
  if (lim) lim = `${currentYear}-${lim.slice(5, 10)}`;
  return { ...P, annee_maj: currentYear, reliquat_cp: Math.max(0, s.cpRestants), date_limite_reliquat: lim || '' };
}
