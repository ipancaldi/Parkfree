"""Build data/zones.json: Islington street -> CPZ zone letters.

Source: RingGo's public Islington parking locator. Each location page's title
names the street and its CPZ ("Alwyne Road N1/CPZ L"). Runs on GitHub Actions.
Polite by design: honours robots.txt, one request per second, identifies itself.
"""
import html as html_lib, json, os, re, sys, time, urllib.request, urllib.robotparser
from datetime import datetime, timezone

BASE = "https://myringgo.co.uk"
LIST = BASE + "/islington/parkinglocator"
UA = "ParkFree-Islington/1.0 (+https://github.com/ipancaldi/Parkfree; personal, non-commercial)"
ZONES = {"A","B","C","D","E","F","G","H","HE","J","K","L","N","P","Q","R","S","T","TW","U","V","W","Y","Z"}


def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            if i == tries - 1:
                raise
            time.sleep(5 * (i + 1))


def norm(s):
    s = s.lower()
    s = re.sub(r"\(\d+\)", " ", s)
    s = re.sub(r"[,.]", " ", s)
    s = re.sub(r"\b(n|ec|wc)\d+[a-z]?\b", "", s)
    return re.sub(r"\s+", " ", s).strip()


def main():
    rp = urllib.robotparser.RobotFileParser()
    try:
        rp.parse(get(BASE + "/robots.txt").splitlines())
    except Exception as e:
        print("robots.txt unavailable:", e)
    if not rp.can_fetch(UA, LIST + "/61001"):
        sys.exit("robots.txt disallows the parking locator; stopping.")

    html = get(LIST)
    os.makedirs("data/debug", exist_ok=True)
    open("data/debug/list.html", "w").write(html[:200000])
    codes = sorted(set(re.findall(r"/islington/parkinglocator/(\d{5})", html)))
    # Street names from the list page: "Alwyne Road N1 (61823)"
    text = re.sub(r"<[^>]+>", "\n", html)
    listed = {}
    for m in re.finditer(r"([A-Z][^\n()]{2,80}?)\s*\((\d{5})\)", text):
        listed.setdefault(m.group(2), m.group(1).strip())
    limit = int(os.environ.get("LIMIT", "0")) or len(codes)
    debug = {"codes": len(codes), "listed_names": len(listed), "samples": [], "errors": {}}
    print(f"{len(codes)} codes, {len(listed)} names from list")
    if len(codes) < 100:
        write_debug(debug); sys.exit("Too few codes found; page layout may have changed.")

    streets, failed = {}, []
    todo = codes if limit >= len(codes) else codes[::max(1, len(codes) // limit)][:limit]
    for i, code in enumerate(todo):
        time.sleep(1.0)
        try:
            page = get(f"{LIST}/{code}")
        except Exception as e:
            failed.append(code); debug["errors"][code] = str(e)[:200]; continue
        if i < 3 or (i % 10 == 0 and i < 40):
            open(f"data/debug/{code}.html", "w").write(page[:100000])
        t = re.search(r"<title[^>]*>(.*?)</title>", page, re.S | re.I)
        title = html_lib.unescape(re.sub(r"\s+", " ", t.group(1)).strip()) if t else ""
        plain = html_lib.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", page)))
        zm = re.search(r"CPZ\s*[-:]?\s*([A-Z]{1,2})\b", title) or re.search(r"CPZ\s*[-:]?\s*([A-Z]{1,2})\b", plain)
        zone = zm.group(1) if zm else None
        name = listed.get(code)
        if not name:
            nm = re.search(r"^(.*?)\s*/\s*CPZ", title)
            name = re.split(r"\s[-|\u2013]\s", nm.group(1))[-1].strip() if nm else None
        if len(debug["samples"]) < 25:
            debug["samples"].append({"code": code, "title": title[:160], "name": name, "zone": zone})
        if not zone or zone not in ZONES or not name:
            failed.append(code); continue
        key = norm(name)
        rec = streets.setdefault(key, {"name": re.sub(r",?\s*\b(N|EC|WC)\d+[A-Z]?\b", "", name).strip(), "zones": {}})
        rec["zones"][zone] = rec["zones"].get(zone, 0) + 1
        if i % 50 == 0:
            print(f"{i}/{len(todo)} {name} -> {zone}", flush=True)

    out = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": LIST,
        "locations": len(todo) - len(failed),
        "failed": failed,
        "streets": dict(sorted(streets.items())),
    }
    debug.update(parsed=len(streets), failed=len(failed))
    write_debug(debug)
    if len(streets) < 20:
        sys.exit(f"Only {len(streets)} streets parsed; not overwriting data.")
    with open("data/zones.json", "w") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
    print(f"{len(streets)} streets, {len(failed)} failed")


def write_debug(d):
    with open("data/debug/summary.json", "w") as f:
        json.dump(d, f, indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main()
