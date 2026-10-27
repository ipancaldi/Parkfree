// ================================================================
//  SIGN READER — turns the text on a UK parking sign into rules,
//  then decides whether *you* can park now with your permits.
//  Pure functions; uses PF (logic.js) for London time, events, Roamer.
// ================================================================
const SIGN = ((PF) => {
  const DAY = { MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6, SUN: 0 };
  const DAYRE = 'MON(?:DAY)?|TUE(?:S(?:DAY)?)?|WED(?:NESDAY)?|THU(?:R(?:S(?:DAY)?)?)?|FRI(?:DAY)?|SAT(?:URDAY)?|SUN(?:DAY)?';
  const dayOf = tok => DAY[tok.slice(0, 3)];
  const range = (a, b) => { const out = []; let d = a; for (let i = 0; i < 7; i++) { out.push(d); if (d === b) break; d = (d + 1) % 7; } return out; };

  function clean(text) {
    return String(text || '')
      .toUpperCase()
      .replace(/[‐-―−]/g, '-')
      .replace(/([0-9])[O]/g, '$10').replace(/[O]([0-9])/g, '0$1')
      .replace(/([0-9])[IL|]/g, '$11').replace(/\b[IL|]([0-9])/g, '1$1')
      .replace(/(\d)\s*[.,:;]\s*(\d{2})/g, '$1.$2')
      .replace(/\bA\.?\s?M\b\.?/g, 'AM').replace(/\bP\.?\s?M\b\.?/g, 'PM')
      .replace(/\bMIDNIGHT\b/g, '12.00AMX').replace(/\bNOON\b|\bMIDDAY\b/g, '12.00PM')
      .replace(/[ \t]+/g, ' ');
  }

  function toMin(h, m, ap) {
    h = +h; m = +(m || 0);
    if (ap === 'AMX') return 1440;                // midnight as an end time
    if (ap === 'AM') { if (h === 12) h = 0; }
    else if (ap === 'PM') { if (h !== 12) h += 12; }
    return h * 60 + m;
  }

  function timesIn(line) {
    const re = /(\d{1,2})(?:\.(\d{2}))?\s*(AMX|AM|PM)?\s*(?:-|TO|UNTIL)\s*(\d{1,2})(?:\.(\d{2}))?\s*(AMX|AM|PM)?/g;
    const out = []; let m;
    while ((m = re.exec(line))) {
      let [, h1, m1, a1, h2, m2, a2] = m;
      if (+h1 > 24 || +h2 > 24 || (m1 && +m1 > 59) || (m2 && +m2 > 59)) continue;
      if (!a1 && !a2 && !m1 && !m2) continue;          // "2 - 4" with no clues: probably not a time
      if (!a1 && a2) {
        if (a2 === 'PM' || a2 === 'AMX') a1 = (+h1 > +h2 && +h1 !== 12) || a2 === 'AMX' ? (+h1 >= 7 && +h1 <= 11 ? 'AM' : 'PM') : 'PM';
        else a1 = 'AM';
        if (a2 === 'PM' && +h1 <= 12 && +h1 >= 7 && +h1 > +h2) a1 = 'AM';
      }
      if (a1 && !a2) a2 = (+h2 < +h1 || a1 === 'PM') ? 'PM' : a1;
      if (!a1 && !a2) {                                // 24-hour clock, e.g. 08.30-18.30
        const f = toMin(h1, m1), t = toMin(h2, m2) || 1440;
        if (t > f) out.push([f, t]);
        continue;
      }
      const f = toMin(h1, m1, a1), t = toMin(h2, m2, a2);
      if (t !== f) out.push([f, t === 0 ? 1440 : t]);
    }
    return out;
  }

  function daysIn(line) {
    if (/\b(EVERY ?DAY|DAILY|ALL DAYS|7 DAYS)\b/.test(line)) return [0, 1, 2, 3, 4, 5, 6];
    const re = new RegExp(`\\b(${DAYRE})\\b(?:\\s*(?:-|TO|THRU)\\s*\\b(${DAYRE})\\b)?`, 'g');
    const set = new Set(); let m;
    while ((m = re.exec(line))) {
      const a = dayOf(m[1]);
      if (m[2] !== undefined) range(a, dayOf(m[2])).forEach(d => set.add(d)); else set.add(a);
    }
    if (/\bEXCEPT\s+(SUN(DAY)?S?)\b/.test(line)) { [1, 2, 3, 4, 5, 6].forEach(d => set.add(d)); set.delete(0); }
    return [...set];
  }

  const MON = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  function datesIn(T) {
    const out = [], today = PF.londonNow().date, y0 = +today.slice(0, 4);
    const push = (d, m, y) => { y = y ? (+y < 100 ? 2000 + +y : +y) : y0; if (m < 1 || m > 12 || d < 1 || d > 31) return;
      out.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`); };
    let m; const re1 = /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/g;
    while ((m = re1.exec(T))) push(+m[1], +m[2], m[3]);
    const re2 = new RegExp(`\\b(\\d{1,2})(?:ST|ND|RD|TH)?\\s+(${MON.join('|')})[A-Z]*\\.?(?:\\s+(\\d{4}))?`, 'g');
    while ((m = re2.exec(T))) push(+m[1], MON.indexOf(m[2]) + 1, m[3]);
    return [...new Set(out)].sort();
  }
  const dur = (n, u) => /^H/.test(u) ? +n * 60 : +n;

  function parse(text) {
    const T = clean(text);
    const lines = T.split(/\n+/).map(s => s.trim()).filter(Boolean);
    const sign = { zone: null, windows: [], anyTime: false, permit: false, paid: false, disabled: false, loading: false,
      noWaiting: false, special: null, maxStay: null, noReturn: null, exceptBH: false, assumedDays: false,
      suspended: false, dates: null, text: T };

    // zone letter
    const zm = T.match(/\b(?:ZONE|CPZ)\s*[:\-]?\s*([A-Z]{1,2})\b/) || T.match(/\b([A-Z]{1,2})\s+PERMIT\s*HOLDERS?\b/) || T.match(/PERMIT\s*HOLDERS?\s*(?:ONLY)?\s*(?:ZONE\s*)?([A-Z]{1,2})\b(?!\w)/);
    if (zm && PF.ZONES[zm[1]]) sign.zone = zm[1];

    sign.permit = /PERMIT\s*HOLDERS?|RESIDENTS?|PERMITS?\b/.test(T) && !/NO\s+PERMIT/.test(T);
    sign.paid = /\bPAY\b|PAYMENT|PAY\s*BY\s*PHONE|RINGGO|PAY\s*(AND|&)\s*DISPLAY|TARIFF|£|SHARED\s*USE/.test(T);
    sign.disabled = /DISABLED|BLUE\s*BADGE|BADGE\s*HOLDERS?/.test(T);
    sign.loading = /\bLOADING\b|GOODS\s*VEHICLES?/.test(T) && !/NO\s+LOADING/.test(T);
    sign.noWaiting = /NO\s+(WAITING|STOPPING|PARKING)\b/.test(T);
    const sp = [[/CAR\s*CLUB/, 'car club vehicles'], [/ELECTRIC|CHARGING|\bEV\b/, 'electric vehicles charging'],
      [/MOTOR\s*CYCLES?|SOLO\s*MOTOR/, 'motorcycles'], [/DOCTORS?\b/, 'doctors'], [/\bTAXIS?\b/, 'taxis'], [/AMBULANCE/, 'ambulances'], [/\bBUS\b/, 'buses']];
    for (const [re, label] of sp) if (re.test(T)) { sign.special = label; break; }
    const ms = T.match(/MAX(?:IMUM)?\.?\s*STAY\s*(\d+)\s*(HOURS?|HRS?|H\b|MINS?|MINUTES?)/);
    if (ms) sign.maxStay = dur(ms[1], ms[2]);
    const nr = T.match(/NO\s*RETURN(?:\s*WITHIN)?\s*(\d+)\s*(HOURS?|HRS?|H\b|MINS?|MINUTES?)/);
    if (nr) sign.noReturn = dur(nr[1], nr[2]);
    sign.exceptBH = /BANK\s*HOLIDAYS?/.test(T) && /EXCEPT/.test(T);
    if (/AT\s*ANY\s*TIME|24\s*(HOURS|HRS)|ANY\s*TIME/.test(T)) sign.anyTime = true;
    if (/SUSPEN[DS]/.test(T)) {
      sign.suspended = true;
      const ds = datesIn(T);
      if (ds.length) sign.dates = { from: ds[0], to: ds[ds.length - 1] };
    }

    // windows, line by line: days carry forward to the next times line
    let lastDays = null, event = false;
    for (const line of lines) {
      if (/MATCH\s*DAYS?|EVENT\s*DAYS?|STADIUM/.test(line)) event = true;
      if (/MAX(IMUM)?\.?\s*STAY|NO\s*RETURN/.test(line)) continue;
      const ds = daysIn(line), ts = timesIn(line);
      if (ds.length) lastDays = ds;
      if (ts.length) {
        let days = ds.length ? ds : lastDays;
        if (!days) { days = [1, 2, 3, 4, 5, 6]; sign.assumedDays = true; }
        ts.forEach(([from, to]) => sign.windows.push({ days, from, to, event }));
      } else if (ds.length && /AT\s*ANY\s*TIME|24\s*(HOURS|HRS)/.test(line)) {
        sign.windows.push({ days: ds, from: 0, to: 1440, event });
      }
    }
    if (sign.anyTime && !sign.windows.length) sign.windows.push({ days: [0, 1, 2, 3, 4, 5, 6], from: 0, to: 1440, event: false });
    return sign;
  }

  // ---------- decide ----------
  function inForce(sign, t) {
    if (sign.exceptBH && PF.isBH(t)) return false;
    return sign.windows.some(w => {
      if (w.event && !PF.eventOn(t.date)) return false;
      if (w.from <= w.to) return w.days.includes(t.dow) && t.min >= w.from && t.min < w.to;
      const prev = (t.dow + 6) % 7;               // overnight window, e.g. 22:00-07:00
      return (w.days.includes(t.dow) && t.min >= w.from) || (w.days.includes(prev) && t.min < w.to);
    });
  }
  function nextFlip(sign, t) {
    const now = inForce(sign, t), start = t.min - (t.min % 5);
    for (let i = 5; i <= 8 * 1440; i += 5) { const u = PF.mk(t.date, start + i); if (inForce(sign, u) !== now) return u; }
    return null;
  }
  const MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const fmtDay = iso => `${+iso.slice(8)} ${MN[+iso.slice(5, 7) - 1]}`;
  const fmtDur = m => m % 60 === 0 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m} minutes`;
  const W = (t, u) => u ? PF.whenLabel(t, u).replace(/^tomorrow (.*)$/, '$1 tomorrow') : '';

  // me = { permit: 'L' | null, badge: bool }
  function decide(sign, t, me = {}) {
    const words = [];
    if (sign.zone) words.push(`Zone ${sign.zone}`);
    if (sign.suspended) {
      const d = sign.dates, active = !d || (t.date >= d.from && t.date <= d.to);
      const until = d ? ` until ${fmtDay(d.to)}` : '';
      if (active && (!sign.windows.length || inForce(sign, t)))
        return { tone: 'stop', head: 'Bay suspended', reason: `No parking here${until}. Suspended bays are enforced and cars can be removed.` };
      if (active) { const f = nextFlip(sign, t); return { tone: 'free', head: 'Free to park', reason: `The suspension starts again ${W(t, f)}${until ? ',' + until.replace(' until', ' ending') : ''}.`, until: f }; }
      if (d && t.date < d.from) return { tone: 'check', head: 'Suspension coming', reason: `This bay is suspended from ${fmtDay(d.from)}${until}. Plan to move before then.` };
    }
    if (!sign.windows.length && !sign.noWaiting)
      return { tone: 'check', head: 'Couldn’t read the hours', reason: 'Set the days and times below, or check the sign yourself.' };
    const on = sign.noWaiting && !sign.windows.length ? true : inForce(sign, t);
    const flip = sign.windows.length ? nextFlip(sign, t) : null;
    if (!on) return { tone: 'free', head: 'Free to park', reason: flip ? `Restrictions start ${W(t, flip)}` : 'No restrictions in the next week', until: flip };
    const until = flip ? `until ${W(t, flip)}` : '';
    const limit = sign.maxStay ? ` Max stay ${fmtDur(sign.maxStay)}${sign.noReturn ? `, no return within ${fmtDur(sign.noReturn)}` : ''}.` : '';
    const roamer = me.permit && PF.roamerWindow(t) && !PF.eventOn(t.date);

    if (sign.noWaiting && !sign.permit && !sign.paid) {
      if (me.badge && !sign.loading) return { tone: 'check', head: 'Blue Badge: up to 3 hours', reason: 'On yellow lines with your clock displayed, unless there’s a loading ban or you’d cause an obstruction.' };
      return { tone: 'stop', head: 'No parking now', reason: `Restrictions apply ${until}.`.replace(' .', '.') };
    }
    if (sign.disabled && !sign.permit && !sign.paid)
      return me.badge ? { tone: 'free', head: 'You can park', reason: 'Blue Badge holders only, and you have one.' }
                      : { tone: 'stop', head: 'Blue Badge holders only', reason: until ? `Restricted ${until}.` : 'Restricted now.' };
    if (sign.special && !sign.permit && !sign.paid)
      return { tone: 'stop', head: `Only for ${sign.special}`, reason: until ? `Restricted ${until}.` : 'Restricted now.' };
    if (sign.loading && !sign.permit && !sign.paid)
      return { tone: 'stop', head: 'Loading only', reason: until ? `Restricted ${until}.` : 'Restricted now.' };
    if (sign.permit) {
      if (me.permit && sign.zone === me.permit) return { tone: 'free', head: 'You can park', reason: `Your Zone ${me.permit} permit covers this bay.` };
      if (me.permit && !sign.zone) return { tone: 'check', head: 'Probably yes', reason: `If the sign’s zone is ${me.permit}, your permit covers it. Pick the zone below if we missed it.` };
      if (roamer) return { tone: 'free', head: 'You can park', reason: 'Roamer: any Islington resident permit can use resident bays Mon–Sat until 15:00.', until: PF.mk(t.date, 900) };
      if (me.badge) return { tone: 'free', head: 'You can park', reason: 'Blue Badge holders have no time limit in resident and shared-use bays in Islington.' };
      if (sign.paid) return { tone: 'check', head: 'Pay to park', reason: `Pay by phone or at the machine ${until}.${limit}`.replace(' .', '.') };
      return { tone: 'stop', head: 'Permit holders only', reason: `${sign.zone ? `Zone ${sign.zone} permits` : 'Permits'} only ${until}.`.replace(' .', '.') };
    }
    if (sign.paid) {
      if (me.badge) return { tone: 'free', head: 'You can park', reason: 'Blue Badge holders have no time limit in pay-by-phone bays in Islington.' };
      return { tone: 'check', head: 'Pay to park', reason: `Pay by phone or at the machine ${until}.${limit}`.replace(' .', '.') };
    }
    return { tone: 'check', head: 'Restrictions apply now', reason: `We couldn’t tell who can park. Check the sign ${until}.`.replace(' .', '.') };
  }

  const DN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function daysLabel(days) {
    const s = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    const key = s.join(',');
    if (key === '1,2,3,4,5') return 'Mon–Fri';
    if (key === '1,2,3,4,5,6') return 'Mon–Sat';
    if (s.length === 7) return 'Every day';
    return s.map(d => DN[d]).join(', ');
  }
  const windowLabel = w => `${daysLabel(w.days)} ${PF.fmt(w.from)}–${w.to === 1440 ? '24:00' : PF.fmt(w.to)}${w.event ? ' (event days)' : ''}`;

  return { clean, timesIn, daysIn, datesIn, parse, inForce, nextFlip, decide, daysLabel, windowLabel, fmtDay };
})(typeof PF !== 'undefined' ? PF : require('./logic.js'));
if (typeof module !== 'undefined') module.exports = SIGN;
