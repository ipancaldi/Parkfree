const PF = require('../src/logic.js');
global.PF = PF;
const SIGN = require('../src/sign.js');
const assert = require('assert');
PF.setEvents([{ date: '2026-11-07', ko: '15:00', name: 'Arsenal v Hull City' }]);
const T = (d, h) => PF.mk(d, PF.hm(h));
let n = 0; const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// Typical Islington resident bay
const s1 = SIGN.parse(`Permit holders only
Zone L
Mon - Fri 8.30am - 6.30pm
Sat 8.30am - 1.30pm`);
eq(s1.zone, 'L'); eq(s1.permit, true); eq(s1.paid, false);
eq(s1.windows.map(SIGN.windowLabel), ['Mon–Fri 08:30–18:30', 'Sat 08:30–13:30']);
eq(SIGN.decide(s1, T('2026-10-27', '10:00'), {}).tone, 'stop', 'visitor, weekday');
eq(SIGN.decide(s1, T('2026-10-27', '10:00'), { permit: 'L' }).tone, 'free', 'own zone');
eq(SIGN.decide(s1, T('2026-10-27', '12:00'), { permit: 'Y' }).head, 'You can park', 'roamer');
eq(SIGN.decide(s1, T('2026-10-27', '16:00'), { permit: 'Y' }).tone, 'stop', 'roamer ended');
eq(SIGN.decide(s1, T('2026-10-31', '14:00'), {}).tone, 'free', 'Sat afternoon');
eq(SIGN.decide(s1, T('2026-10-27', '10:00'), { badge: true }).tone, 'free', 'blue badge');
eq(SIGN.decide(s1, T('2026-10-27', '19:00'), {}).reason, 'Restrictions start 08:30 tomorrow');

// Shared use, pay by phone, OCR noise (O for 0, missing am)
const s2 = SIGN.parse(`SHARED USE
Pay by phone or permit holders Zone E
Mon - Sat
8.3O - 6.30pm
Max stay 2 hours No return within 1 hour`);
eq(s2.zone, 'E'); eq(s2.paid, true); eq(s2.permit, true);
eq(s2.windows.map(SIGN.windowLabel), ['Mon–Sat 08:30–18:30']);
eq(s2.maxStay, 120); eq(s2.noReturn, 60);
const d2 = SIGN.decide(s2, T('2026-10-27', '10:00'), {});
eq(d2.head, 'Pay to park'); eq(/Max stay 2 hours, no return within 1 hour/.test(d2.reason), true);

// Disabled bay, at any time
const s3 = SIGN.parse(`Disabled badge holders only
At any time`);
eq(SIGN.decide(s3, T('2026-10-27', '23:00'), {}).tone, 'stop');
eq(SIGN.decide(s3, T('2026-10-27', '23:00'), { badge: true }).tone, 'free');

// Short controls, 24h clock
const s4 = SIGN.parse(`Controlled zone HE
Mon-Fri 10.00-14.00`);
eq(s4.zone, 'HE'); eq(s4.windows.map(SIGN.windowLabel), ['Mon–Fri 10:00–14:00']);
eq(SIGN.decide(s4, T('2026-10-27', '15:00'), {}).tone, 'free');

// Event-day plate below a normal sign
const s5 = SIGN.parse(`Permit holders only Zone Y
Mon - Sat 8.30am - 1.30pm
Match days
Sat 1.30pm - 4.30pm`);
eq(s5.windows.length, 2); eq(s5.windows[1].event, true);
eq(SIGN.decide(s5, T('2026-10-31', '14:00'), {}).tone, 'free', 'non-event Saturday');
eq(SIGN.decide(s5, T('2026-11-07', '14:00'), {}).tone, 'stop', 'event Saturday');

// Single yellow line plate
const s6 = SIGN.parse(`No waiting
Mon - Sat 8am - 6.30pm`);
eq(SIGN.decide(s6, T('2026-10-27', '09:00'), {}).head, 'No parking now');
eq(SIGN.decide(s6, T('2026-10-27', '19:00'), {}).tone, 'free');

// Midnight end, loading
const s7 = SIGN.parse(`Loading only
Mon - Sun 7am - midnight`);
eq(s7.windows.map(SIGN.windowLabel), ['Every day 07:00–24:00']);
eq(SIGN.decide(s7, T('2026-10-27', '23:30'), {}).head, 'Loading only');

// Unreadable
eq(SIGN.decide(SIGN.parse('PERMIT HOLDERS ZONE L'), T('2026-10-27', '10:00'), {}).head, 'Couldn’t read the hours');

// Yellow suspension notice
const s8 = SIGN.parse(`PARKING SUSPENDED
Bay suspended from 28/10/2026 to 30/10/2026
8am - 6pm
Vehicles parked in the suspended bay may be removed`);
eq(s8.suspended, true); eq(s8.dates, { from: '2026-10-28', to: '2026-10-30' });
eq(SIGN.decide(s8, T('2026-10-29', '10:00'), { permit: 'L' }).head, 'Bay suspended', 'permit does not help');
eq(SIGN.decide(s8, T('2026-10-29', '19:00'), {}).tone, 'free', 'outside suspension hours');
eq(SIGN.decide(s8, T('2026-10-27', '10:00'), {}).head, 'Suspension coming');
const s9 = SIGN.parse(`Suspended 12th November 2026 - 14th November 2026 at any time`);
eq(s9.dates, { from: '2026-11-12', to: '2026-11-14' });
eq(SIGN.decide(s9, T('2026-11-13', '03:00'), {}).head, 'Bay suspended');

console.log(`all ${n} sign tests passed`);
