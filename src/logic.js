// ================================================================
//  PARKFREE RULES ENGINE — pure functions, no DOM.
//  Sources (checked 26 Oct 2026):
//   • islington.gov.uk/parking/parking-restrictions/controlled-parking-zones
//   • islington.gov.uk/parking/parking-restrictions/emirates-stadium-restrictions
//   • islington.gov.uk/parking/parking-restrictions/resident-roamer-scheme
//   • help.arsenal.com "Fixture and Event Timings for Local Residents"
//  All times are London wall-clock minutes from midnight.
// ================================================================
const PF = (() => {
  const hm = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const fmt = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  // wk = Mon–Fri window, sat = Saturday window; null = no control.
  // md = matchday group (E, G, Q) or null.
  const STD = { wk: ['08:30', '18:30'], sat: ['08:30', '13:30'] };
  const ZONES = {
    A:  { ...STD, md: null }, B: { ...STD, md: null },
    C:  { special: 'C', md: null, label: 'Mon–Fri 24 hrs · Sat all day until Sun 06:00' },
    D:  { wk: ['09:30', '16:30'], sat: null, md: null },
    E:  { ...STD, md: 'E' }, F: { ...STD, md: 'E' },
    G:  { wk: ['10:00', '14:00'], sat: null, md: 'G', label: 'Mon–Fri 10:00–14:00 · weekends only on event days' },
    H:  { wk: ['08:30', '18:30'], sat: ['08:30', '18:30'], md: 'E' },
    HE: { wk: ['10:00', '14:00'], sat: null, md: null },
    J:  { wk: ['08:30', '18:30'], sat: ['08:30', '18:30'], md: 'E' },
    K:  { special: 'K', md: null, label: '24 hrs, every day' },
    L:  { ...STD, md: 'E' }, N: { ...STD, md: 'E' }, P: { ...STD, md: null },
    Q:  { wk: ['08:30', '18:30'], sat: null, md: 'Q', label: 'Mon–Fri 08:30–18:30 · weekends only on event days' },
    R:  { wk: ['08:30', '18:30'], sat: null, md: null },
    S:  { ...STD, md: null }, T: { ...STD, md: null },
    TW: { wk: ['10:00', '14:00'], sat: null, md: null },
    U:  { wk: ['10:00', '12:00'], sat: null, md: null },
    V:  { ...STD, md: 'E' },
    W:  { wk: ['08:30', '18:30'], sat: null, md: null },
    // Y: CPZ table marks Y as event-day controlled, but the Emirates page's
    // zone list omits it. Treated as controlled (group E) to avoid tickets.
    Y:  { ...STD, md: 'E', mdNote: 'Council pages disagree on whether Y has event-day controls — treated as yes. Check the yellow signs.' },
    Z:  { wk: ['10:00', '14:00'], sat: null, md: null },
  };
  const ZONE_IDS = Object.keys(ZONES);
  // Event-day extra control windows (council Emirates page)
  const MD = {
    E: { wk: ['18:30', '20:30'], sat: ['13:30', '16:30'], sun: ['12:00', '16:30'] },
    G: { wk: ['14:00', '20:30'], sat: ['12:00', '16:30'], sun: ['12:00', '16:30'] },
    Q: { wk: ['18:30', '20:30'], sat: ['12:00', '16:30'], sun: ['12:00', '16:30'] },
  };

  function zoneLabel(id) {
    const z = ZONES[id]; if (!z) return '';
    if (z.label) return z.label;
    const p = [];
    if (z.wk) p.push(`Mon–Fri ${z.wk[0]}–${z.wk[1]}`);
    if (z.sat) p.push(`Sat ${z.sat[0]}–${z.sat[1]}`);
    if (!z.sat) p.push('weekends free');
    return p.join(' · ');
  }
  function mdLabel(id) {
    const z = ZONES[id]; if (!z || !z.md) return null;
    const w = MD[z.md];
    return `Event days: Mon–Fri ${w.wk.join('–')} · Sat ${w.sat.join('–')} · Sun/BH ${w.sun.join('–')}`;
  }

  // ---- London clock ----
  const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  function londonNow(d = new Date()) {
    const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' });
    const o = {}; f.formatToParts(d).forEach(p => o[p.type] = p.value);
    return mk(`${o.year}-${o.month}-${o.day}`, (+o.hour % 24) * 60 + +o.minute);
  }
  // A wall-clock moment: {date:'YYYY-MM-DD', min, dow}
  function mk(date, min) {
    const [y, m, d] = date.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    while (min >= 1440) { dt.setUTCDate(dt.getUTCDate() + 1); min -= 1440; }
    while (min < 0) { dt.setUTCDate(dt.getUTCDate() - 1); min += 1440; }
    const iso = dt.toISOString().slice(0, 10);
    return { date: iso, min, dow: dt.getUTCDay() };
  }
  const addMin = (t, n) => mk(t.date, t.min + n);

  // ---- Bank holidays (England & Wales); runtime list replaces this ----
  let BANK_HOLS = new Set(['2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-08-31',
    '2026-12-25', '2026-12-28', '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03', '2027-05-31',
    '2027-08-30', '2027-12-27', '2027-12-28']);
  const setBankHols = arr => { if (arr && arr.length) BANK_HOLS = new Set([...BANK_HOLS, ...arr]); };
  const isBH = t => BANK_HOLS.has(t.date);

  // ---- Events at Emirates (any event triggers controls) ----
  let EVENTS = [];
  const setEvents = arr => { EVENTS = arr.slice().sort((a, b) => (a.date + a.ko).localeCompare(b.date + b.ko)); };
  const eventOn = date => EVENTS.find(e => e.date === date) || null;

  const inWin = (w, m) => !!w && m >= hm(w[0]) && m < hm(w[1]);

  function normalControl(id, t) {
    const z = ZONES[id];
    if (z.special === 'K') return true;
    if (z.special === 'C') {
      // Bank holidays: not stated for 24-hr zones → assume controlled.
      if (t.dow >= 1 && t.dow <= 6) return true;
      return t.min < hm('06:00'); // Sunday until 06:00
    }
    if (isBH(t)) return false;
    if (t.dow >= 1 && t.dow <= 5) return inWin(z.wk, t.min);
    if (t.dow === 6) return inWin(z.sat, t.min);
    return false;
  }
  function matchdayControl(id, t) {
    const z = ZONES[id]; if (!z.md || !eventOn(t.date)) return false;
    const w = MD[z.md];
    const win = (t.dow === 0 || isBH(t)) ? w.sun : t.dow === 6 ? w.sat : w.wk;
    return inWin(win, t.min);
  }
  const roamerWindow = t => t.dow >= 1 && t.dow <= 6 && t.min >= hm('11:00') && t.min < hm('15:00');

  // profile: {permit: null | 'X' (own zone letter), resident: bool}
  function status(id, t, profile = {}) {
    const z = ZONES[id];
    if (!z) return { state: 'unknown', head: 'ZONE UNKNOWN', detail: 'Read the zone letter on the CPZ sign' };
    const md = matchdayControl(id, t), norm = normalControl(id, t);
    const own = profile.permit && profile.permit === id;
    if (md) {
      if (own) return { state: 'permit', head: 'OK WITH YOUR PERMIT', detail: `Event-day controls in Zone ${id} · your Zone ${id} permit is valid` };
      return { state: 'matchday', head: 'EVENT-DAY CONTROLS', detail: `Zone ${id} permit or event-day paid parking only` };
    }
    if (norm) {
      if (own) return { state: 'permit', head: 'OK WITH YOUR PERMIT', detail: `Zone ${id} controlled · your permit covers it` };
      if (profile.permit && roamerWindow(t)) return { state: 'roamer', head: 'FREE — ROAMER', detail: 'Resident bays only (not pay-by-phone or business bays)' };
      return { state: 'restricted', head: 'RESTRICTED', detail: `Zone ${id} permit or paid bay only` };
    }
    return { state: 'free', head: 'FREE TO PARK', detail: `Zone ${id} controls not in force` };
  }
  const isFree = s => ['free', 'roamer', 'permit'].includes(s.state);

  // Next time the free/not-free verdict flips (5-min steps, up to 8 days)
  function nextChange(id, t, profile) {
    const f0 = isFree(status(id, t, profile));
    const start = t.min - (t.min % 5);
    for (let i = 5; i <= 8 * 1440; i += 5) {
      const u = mk(t.date, start + i);
      if (isFree(status(id, u, profile)) !== f0) return u;
    }
    return null;
  }
  function whenLabel(t, u) {
    if (!u) return 'no change this week';
    const days = Math.round((Date.parse(u.date) - Date.parse(t.date)) / 864e5);
    const dn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][u.dow];
    return days === 0 ? fmt(u.min) : days === 1 ? `tomorrow ${fmt(u.min)}` : `${dn} ${fmt(u.min)}`;
  }

  return { ZONES, ZONE_IDS, MD, zoneLabel, mdLabel, londonNow, mk, addMin, setBankHols, isBH,
    setEvents, eventOn, get EVENTS() { return EVENTS; }, normalControl, matchdayControl, roamerWindow,
    status, isFree, nextChange, whenLabel, fmt, hm };
})();
if (typeof module !== 'undefined') module.exports = PF;
