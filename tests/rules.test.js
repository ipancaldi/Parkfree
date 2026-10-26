const PF = require('../src/logic.js');
const assert = require('assert');
PF.setEvents([{ date: '2026-11-07', ko: '15:00', name: 'Arsenal v Hull City' },
              { date: '2026-11-24', ko: '20:00', name: 'Arsenal v Dortmund' },
              { date: '2026-11-01', ko: '12:00', name: 'Women v Aston Villa' }]);
const T = (d, h) => PF.mk(d, PF.hm(h));
const st = (z, d, h, p) => PF.status(z, T(d, h), p).state;
let n = 0; const eq = (a, b, m) => { assert.strictEqual(a, b, m); n++; };

// Mon 26 Oct 2026
eq(T('2026-10-26', '10:00').dow, 1, 'Mon');
eq(st('L', '2026-10-26', '10:00'), 'restricted');
eq(st('L', '2026-10-26', '18:30'), 'free', 'ends 18:30');
eq(st('L', '2026-10-26', '08:29'), 'free');
// Saturday: standard zones end 13:30, H/J 18:30
eq(st('L', '2026-10-31', '13:00'), 'restricted');
eq(st('L', '2026-10-31', '14:00'), 'free', 'Sat afternoon free');
eq(st('H', '2026-10-31', '14:00'), 'restricted', 'H Sat till 18:30');
eq(st('R', '2026-10-31', '10:00'), 'free', 'R no Sat');
// Matchday Sat 7 Nov
eq(st('L', '2026-11-07', '14:00'), 'matchday');
eq(st('L', '2026-11-07', '16:30'), 'free');
eq(st('G', '2026-11-07', '12:30'), 'matchday', 'G from 12:00 Sat');
eq(st('Q', '2026-11-07', '11:00'), 'free', 'Q weekend normally free');
eq(st('A', '2026-11-07', '14:00'), 'free', 'A not matchday, Sat after 13:30');
eq(st('Y', '2026-11-07', '14:00'), 'matchday', 'Y conservative');
// Weekday evening match Tue 24 Nov
eq(st('N', '2026-11-24', '19:00'), 'matchday');
eq(st('N', '2026-11-24', '20:30'), 'free');
eq(st('G', '2026-11-24', '15:00'), 'matchday', 'G weekday from 14:00');
// Sunday matchday (women) 1 Nov
eq(st('E', '2026-11-01', '12:30'), 'matchday');
eq(st('E', '2026-11-08', '12:30'), 'free', 'non-event Sunday');
// Zone C
eq(st('C', '2026-11-01', '05:00'), 'restricted', 'C Sun before 6');
eq(st('C', '2026-11-01', '07:00'), 'free', 'C Sun after 6');
eq(st('C', '2026-10-31', '23:00'), 'restricted');
eq(st('K', '2026-11-01', '15:00'), 'restricted');
// Bank holiday 25 Dec 2026 (Fri)
eq(st('L', '2026-12-25', '10:00'), 'free', 'BH free');
// Roamer
const res = { permit: 'Y' };
eq(st('L', '2026-10-26', '11:30', res), 'roamer');
eq(st('L', '2026-10-26', '15:00', res), 'restricted');
eq(st('Y', '2026-10-26', '10:00', res), 'permit');
eq(st('G', '2026-11-07', '12:30', res), 'matchday', 'no roamer during event controls');
eq(st('Y', '2026-11-07', '14:00', res), 'permit', 'own zone on matchday');
// nextChange
const t = T('2026-10-26', '16:07');
eq(PF.whenLabel(t, PF.nextChange('L', t)), '18:30');
const s = T('2026-10-31', '14:00');
eq(PF.whenLabel(s, PF.nextChange('L', s)), 'tomorrow 12:00', 'Sun 1 Nov women event');
// London clock: 26 Oct 2026 15:07 UTC = 15:07 GMT (BST ended 25 Oct)
const ln = PF.londonNow(new Date('2026-10-26T15:07:00Z'));
eq(ln.min, PF.hm('15:07')); eq(ln.date, '2026-10-26');
const lb = PF.londonNow(new Date('2026-10-20T15:07:00Z'));
eq(lb.min, PF.hm('16:07'), 'BST');
console.log(`all ${n} tests passed`);
