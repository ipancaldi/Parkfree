"""Build data/events.json: Emirates Stadium event days (men's, women's, cups, concerts).

Primary source: Arsenal's "Fixture and Event Timings for Local Residents" help article,
which lists every event with its kick-off. Secondary: fixturedownload.com's Premier League
feed (home games at the Emirates), used to fill gaps. Runs weekly on GitHub Actions.
"""
import html as html_lib, json, os, re, sys, time, urllib.request
from datetime import date, datetime, timezone, timedelta

UA = "ParkFree-Islington/1.0 (+https://github.com/ipancaldi/Parkfree; personal, non-commercial)"
ARSENAL = "https://help.arsenal.com/support/solutions/articles/101000594163-fixture-and-event-timings-for-local-residents"
FEEDS = ["https://fixturedownload.com/feed/json/epl-{y}", "https://fixturedownload.com/feed/json/wsl-{y}"]
MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
LOG = []


def log(*a):
    msg = " ".join(str(x) for x in a)
    print(msg, flush=True)
    LOG.append(msg)


def get(url):
    for i in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/json"})
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            log("fetch failed", url, i + 1, str(e)[:150])
            time.sleep(5 * (i + 1))
    return None


def to_text(h):
    h = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", h)
    h = re.sub(r"(?i)<br\s*/?>|</(p|div|li|tr|h\d|td|th)>", "\n", h)
    t = html_lib.unescape(re.sub(r"<[^>]+>", " ", h))
    return "\n".join(re.sub(r"[ \t\xa0]+", " ", ln).strip() for ln in t.splitlines() if ln.strip())


DATE_RE = re.compile(r"\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s*(\d{4})?", re.I)
TIME_RE = re.compile(r"\b([01]?\d|2[0-3])[:.]([0-5]\d)\b")
NAME_RE = re.compile(r"(Arsenal[^\n|]{0,40}?\s+v(?:s\.?)?\s+[^\n|*(]{2,40})", re.I)


def parse_arsenal(text, today):
    events = {}
    lines = text.splitlines()
    for i, ln in enumerate(lines):
        for m in DATE_RE.finditer(ln):
            mon = MONTHS.get(m.group(2)[:3].lower())
            if not mon:
                continue
            day = int(m.group(1))
            year = int(m.group(3)) if m.group(3) else (today.year + (1 if mon < today.month - 2 else 0))
            try:
                d = date(year, mon, day)
            except ValueError:
                continue
            ctx = " | ".join(lines[i:i + 4])
            tail = ctx[m.end():] if ctx.startswith(ln) else ctx
            tm = TIME_RE.search(tail)
            nm = NAME_RE.search(ctx) or NAME_RE.search(" | ".join(lines[max(0, i - 2):i + 1]))
            if not nm:
                continue
            name = re.sub(r"\s+", " ", nm.group(1)).strip(" -–|")
            events[d.isoformat()] = {"date": d.isoformat(), "ko": f"{int(tm.group(1)):02d}:{tm.group(2)}" if tm else "", "name": name, "src": "arsenal"}
    return events


def parse_feed(raw):
    out = {}
    try:
        for g in json.loads(raw):
            if "Arsenal" in (g.get("HomeTeam") or "") and "Emirates" in (g.get("Location") or "Emirates"):
                dt = datetime.strptime(g["DateUtc"].replace("Z", ""), "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
                # London time: BST from last Sunday of March to last Sunday of October
                y = dt.year
                bst_start = max(date(y, 3, d) for d in range(25, 32) if date(y, 3, d).weekday() == 6)
                bst_end = max(date(y, 10, d) for d in range(25, 32) if date(y, 10, d).weekday() == 6)
                local = dt + timedelta(hours=1 if bst_start <= dt.date() < bst_end else 0)
                out[local.date().isoformat()] = {"date": local.date().isoformat(), "ko": local.strftime("%H:%M"),
                                                 "name": f"Arsenal v {g.get('AwayTeam', '')}".strip(), "src": "feed"}
    except Exception as e:
        log("feed parse failed", str(e)[:150])
    return out


def main():
    today = date.today()
    os.makedirs("data/debug", exist_ok=True)
    events = {}
    h = get(ARSENAL)
    if h:
        text = to_text(h)
        open("data/debug/arsenal.txt", "w").write(text[:60000])
        a = parse_arsenal(text, today)
        log(f"arsenal page: {len(a)} events")
        events.update(a)
    season = today.year if today.month >= 7 else today.year - 1
    for f in FEEDS:
        raw = get(f.format(y=season))
        if raw:
            fe = parse_feed(raw)
            added = {k: v for k, v in fe.items() if k not in events}
            log(f"{f.format(y=season)}: {len(fe)} home games, {len(added)} not on the Arsenal page")
            events.update(added)
    future = [e for e in events.values() if e["date"] >= today.isoformat()]
    log(f"total {len(events)} events, {len(future)} from today")
    open("data/debug/events-log.txt", "w").write("\n".join(LOG) + "\n")
    if len(future) < 3:
        sys.exit("Too few future events found; keeping the existing list.")
    with open("data/events.json", "w") as f:
        json.dump({"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                   "events": sorted(events.values(), key=lambda e: e["date"])}, f, indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main()
