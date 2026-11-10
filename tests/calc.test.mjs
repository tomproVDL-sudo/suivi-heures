import assert from 'node:assert/strict';
import { Engine, prepPointage, feriesAnnee, rolloverParams } from '../js/calc.js';
import { parseDay, fmtDur, readExcelDate, readExcelTime, isoWeek } from '../js/util.js';

const P = (d, hm, type) => prepPointage({ id: Math.random(), type_action: type, timestamp: new Date(`${d}T${hm}:00`).toISOString() });
// Fériés 2026 : Pâques 5 avril
const f = feriesAnnee(2026);
assert.equal(f['2026-04-06'], 'Lundi de Pâques'); assert.equal(f['2026-05-14'], 'Ascension'); assert.equal(f['2026-05-25'], 'Lundi de Pentecôte');
const f24 = feriesAnnee(2024); assert.equal(f24['2024-04-01'], 'Lundi de Pâques');

// Journée type : 8h00-12h00 pause 12h45 reprise -> 17h00 = 4h + 4h15
const pts = [P('2026-11-09','08:00','arrivee'), P('2026-11-09','12:00','pause'), P('2026-11-09','12:45','arrivee'), P('2026-11-09','17:00','depart')];
const e = new Engine({ pointages: pts, absences: [], params: { base_horaire: 39 } });
const s = e.summary('2026-11-09', new Date('2026-11-10T10:00:00').getTime());
assert.equal(fmtDur(s.work), '8h15'); assert.equal(fmtDur(s.pause), '0h45'); assert.equal(s.nbPauses, 1); assert.equal(s.status, 'done');
assert.equal(fmtDur(s.amplitude), '9h00');
// Jour en cours (live)
const e2 = new Engine({ pointages: [P('2026-11-10','08:00','arrivee')] });
const live = e2.summary('2026-11-10', new Date('2026-11-10T10:30:00').getTime());
assert.equal(fmtDur(live.work), '2h30'); assert.equal(live.status, 'work');
// Attendu : 39h -> 7h48 ; avant 2022 : 35h -> 7h00
assert.equal(fmtDur(e.dayPlan('2026-11-09').expected), '7h48');
assert.equal(fmtDur(e.dayPlan('2021-11-08').expected), '7h00');
assert.equal(e.dayPlan('2026-11-11').expected, 0); // 11 novembre
// Absences : CP lun->dim = 5 jours ouvrés ; demi-journée ; formation
const abs = [
  { id:1, type_absence:'CP', moment:'journee', date_debut:'2026-08-03', date_fin:'2026-08-09' },
  { id:2, type_absence:'RTT', moment:'matin', date_debut:'2026-11-13', date_fin:'2026-11-13' },
  { id:3, type_absence:'Formation', moment:'matin', date_debut:'2026-11-12', date_fin:'2026-11-12' },
  { id:4, type_absence:'CP', moment:'journee', date_debut:'2026-01-05', date_fin:'2026-01-09' },
  { id:5, type_absence:'RTT', moment:'journee', date_debut:'2026-05-15', date_fin:'2026-05-15' }, // pont vendredi après Ascension
];
const e3 = new Engine({ pointages: [], absences: abs, params: { base_horaire: 39, cp_initial: 25, rtt_initial: 15, reliquat_cp: 3, date_limite_reliquat: '2026-03-31' } });
assert.equal(e3.absenceDays(abs[0]), 5);
assert.equal(fmtDur(e3.dayPlan('2026-11-13').expected), '3h54');
const pf = e3.dayPlan('2026-11-12'); assert.equal(fmtDur(pf.expected), '7h48'); assert.equal(fmtDur(pf.credit), '3h54');
const so = e3.soldes(2026, new Date('2026-11-10T12:00:00').getTime());
// CP pris : 5 (janv) + 5 (août) = 10 ; reliquat 3 consommé en janvier ; CP N restants = 25 - (10-3) = 18
assert.equal(so.cons.CP, 10); assert.equal(so.reliquatRestant, 0); assert.equal(so.cpRestants, 18);
assert.equal(so.fractionnement, 5); assert.equal(so.jFrac, 1);
assert.equal(so.cons.RTT, 1.5); assert.equal(so.rttRestants, 13.5); assert.equal(so.rttAlerte, true);
assert.equal(so.pontsPoses, 1); assert.ok(so.pontsPossibles >= 1);
// Report de reliquat à l'année suivante
const ro = rolloverParams(new Engine({ absences: abs, params: { annee_maj: 2026, cp_initial: 25, reliquat_cp: 3, date_limite_reliquat: '2026-03-31' } }), 2027);
assert.equal(ro.reliquat_cp, 18); assert.equal(ro.date_limite_reliquat, '2027-03-31'); assert.equal(ro.annee_maj, 2027);
// Stats période
const many = [];
for (const d of ['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06']) many.push(P(d,'08:30','arrivee'), P(d,'12:00','pause'), P(d,'12:40','arrivee'), P(d,'17:30','depart'));
many.push(P('2026-11-07','05:00','arrivee'), P('2026-11-07','16:30','depart')); // samedi > 10h, pas de pause
const e4 = new Engine({ pointages: many, params: { base_horaire: 39 } });
const st = e4.stats(parseDay('2026-11-01'), parseDay('2026-11-30'), new Date('2026-11-10T12:00:00').getTime());
assert.equal(st.kpi.workedDays, 6);
assert.equal(st.compliance.over10.length, 1); assert.equal(st.compliance.shortPause.length, 1);
assert.equal(st.kpi.medArrival, 8.5);
assert.equal(st.months.length, 1); assert.equal(st.cumul.length, 10);
// Repos < 11h : départ 23h -> arrivée 7h le lendemain
const r = new Engine({ pointages: [P('2026-10-05','09:00','arrivee'), P('2026-10-05','23:00','depart'), P('2026-10-06','07:00','arrivee'), P('2026-10-06','12:00','depart')] });
assert.equal(r.stats(parseDay('2026-10-01'), parseDay('2026-10-31'), Date.now()).compliance.shortRest.length, 1);
// Objectif
const o = e4.objectif(new Date('2026-11-10T12:00:00').getTime()); assert.ok(o.cumul > 40*3600000);
// Excel
assert.equal(readExcelDate(46336), '2026-11-10'); assert.equal(readExcelDate('10/11/2026'), '2026-11-10'); assert.equal(readExcelDate('2026-11-10'), '2026-11-10');
assert.equal(readExcelTime(0.5), '12:00'); assert.equal(readExcelTime('8:05'), '08:05'); assert.equal(readExcelTime(46336.75), '18:00');
assert.deepEqual(isoWeek(parseDay('2026-01-01')), { year: 2026, week: 1 });
console.log('OK : tous les tests de calcul passent');
