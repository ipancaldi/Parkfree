"""Build data/zones.json: Islington street -> CPZ zone letters.

Source: RingGo's public Islington parking locator. Each location page's title
names the street and its CPZ ("Alwyne Road N1/CPZ L"). Runs on GitHub Actions.
Polite by design: honours robots.txt, one request per second, identifies itself.
"""
import json, re, sys, time, urllib.request, urllib.robotparser
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
    codes = sorted(set(re.findall(r"/islington/parkinglocator/(\d{5})", html)))
    print(f"{len(codes)} location codes")
    if len(codes) < 100:
        sys.exit("Too few codes found; page layout may have changed.")

    streets, failed = {}, []
    for i, code in enumerate(codes):
        time.sleep(1.0)
        try:
            page = get(f"{LIST}/{code}")
        except Exception as e:
            failed.append(code); continue
        t = re.search(r"<title>\s*(.*?)\s*</title>", page, re.S | re.I)
        title = re.sub(r"\s+", " ", t.group(1)) if t else ""
        m = re.search(r"^(.*?)\s*/\s*CPZ\s+([A-Z]{1,2})\b", title)
        if not m:
            m2 = re.search(r"CPZ\s+([A-Z]{1,2})\b", page)
            name = re.split(r"[/|\-–]", title)[0].strip()
            zone = m2.group(1) if m2 else None
        else:
            name, zone = re.split(r"\s[-|–]\s", m.group(1))[-1].strip(), m.group(2)
        if not zone or zone not in ZONES or not name:
            failed.append(code); continue
        key = norm(name)
        rec = streets.setdefault(key, {"name": re.sub(r",?\s*\b(N|EC|WC)\d+[A-Z]?\b", "", name).strip(), "zones": {}})
        rec["zones"][zone] = rec["zones"].get(zone, 0) + 1
        if i % 50 == 0:
            print(f"{i}/{len(codes)} {name} -> {zone}")

    out = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": LIST,
        "locations": len(codes) - len(failed),
        "failed": failed,
        "streets": dict(sorted(streets.items())),
    }
    if len(streets) < 50:
        sys.exit(f"Only {len(streets)} streets parsed; not overwriting data.")
    with open("data/zones.json", "w") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
    print(f"{len(streets)} streets, {len(failed)} failed")


if __name__ == "__main__":
    main()
