"""Build data/streets.json: Islington's named roads and borough boundary from OpenStreetMap.

Shipping this with the app means finding the street under your finger, colouring the map
and listing nearby free streets all happen on the phone, without asking a live map service.
Runs on GitHub Actions (monthly and on change). Map data © OpenStreetMap contributors (ODbL).
"""
import json, math, os, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone

UA = "ParkFree-Islington/1.0 (+https://github.com/ipancaldi/Parkfree)"
ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
BBOX = "51.5130,-0.1470,51.5780,-0.0750"  # Islington plus a margin
Q_STREETS = f"""[out:json][timeout:120];
way({BBOX})["highway"~"^(trunk|primary|secondary|tertiary|unclassified|residential|living_street)$"]["name"];
out tags geom;"""
Q_BOUNDARY = f"""[out:json][timeout:60];
rel({BBOX})["boundary"="administrative"]["admin_level"="8"]["name"~"Islington"];
out geom;"""
LOG = []


def log(*a):
    msg = " ".join(str(x) for x in a)
    print(msg, flush=True)
    LOG.append(datetime.now(timezone.utc).strftime("%H:%M:%S ") + msg)


def save_log():
    os.makedirs("data/debug", exist_ok=True)
    with open("data/debug/streets-log.txt", "w") as f:
        f.write("\n".join(LOG) + "\n")


def fetch(query, label):
    body = urllib.parse.urlencode({"data": query}).encode()
    for ep in ENDPOINTS:
        for attempt in range(2):
            t0 = time.time()
            try:
                req = urllib.request.Request(ep, data=body, headers={"User-Agent": UA, "Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=150) as r:
                    raw = r.read()
                d = json.loads(raw)
                log(f"{label}: {ep} ok in {time.time()-t0:.0f}s, {len(d.get('elements', []))} elements, {len(raw)} bytes")
                if d.get("remark"):
                    log(f"{label}: remark: {d['remark'][:200]}")
                return d
            except Exception as e:
                log(f"{label}: {ep} attempt {attempt+1} failed after {time.time()-t0:.0f}s: {str(e)[:200]}")
                time.sleep(8)
    return None


def _perp(p, a, b, k):
    ax, ay = (a[1] - p[1]) * k, a[0] - p[0]
    bx, by = (b[1] - p[1]) * k, b[0] - p[0]
    dx, dy = bx - ax, by - ay
    l = dx * dx + dy * dy
    t = 0 if l == 0 else max(0, min(1, -(ax * dx + ay * dy) / l))
    return math.hypot(ax + t * dx, ay + t * dy)


def simplify(pts, eps):
    """Ramer-Douglas-Peucker, iterative. eps in degrees of latitude."""
    if len(pts) < 3:
        return pts
    k = math.cos(math.radians(pts[0][0]))
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        best, idx = 0, None
        for m in range(i + 1, j):
            d = _perp(pts[m], pts[i], pts[j], k)
            if d > best:
                best, idx = d, m
        if idx is not None and best > eps:
            keep[idx] = True
            stack += [(i, idx), (idx, j)]
    return [p for p, f in zip(pts, keep) if f]


def flat(pts):
    out = []
    for la, lo in pts:
        out += [round(la, 5), round(lo, 5)]
    return out


def rings(rel):
    segs = [[(p["lat"], p["lon"]) for p in m["geometry"]]
            for m in rel.get("members", []) if m.get("type") == "way" and m.get("role") == "outer" and m.get("geometry")]
    out = []
    while segs:
        ring = segs.pop(0)
        grew = True
        while ring[0] != ring[-1] and grew:
            grew = False
            for i, s in enumerate(segs):
                if s[0] == ring[-1]:
                    ring = ring + s[1:]
                elif s[-1] == ring[-1]:
                    ring = ring + s[::-1][1:]
                elif s[-1] == ring[0]:
                    ring = s[:-1] + ring
                elif s[0] == ring[0]:
                    ring = s[::-1][:-1] + ring
                else:
                    continue
                segs.pop(i)
                grew = True
                break
        if ring[0] == ring[-1] and len(ring) >= 4:
            out.append(ring)
    return out


def build(d):
    streets = {}
    boundary = []
    for e in d.get("elements", []):
        if e.get("type") == "way" and e.get("geometry") and e.get("tags", {}).get("name"):
            pts = [(g["lat"], g["lon"]) for g in e["geometry"]]
            streets.setdefault(e["tags"]["name"], []).append(flat(simplify(pts, 0.00002)))
        elif e.get("type") == "relation":
            boundary = [flat(simplify(r, 0.00005)) for r in rings(e)]
    return streets, boundary


def main():
    try:
        d = fetch(Q_STREETS, "streets")
        if not d:
            sys.exit("All Overpass endpoints failed for streets")
        b = fetch(Q_BOUNDARY, "boundary") or {"elements": []}
        streets, _ = build(d)
        rels = [e for e in b.get("elements", []) if e.get("type") == "relation" and "Islington" in e.get("tags", {}).get("name", "")]
        boundary = [flat(simplify(r, 0.00005)) for r in rings(rels[0])] if rels else []
        log(f"{len(streets)} named streets, {len(boundary)} boundary rings")
        if len(streets) < 300:
            sys.exit("Too few streets; not overwriting data.")
        out = {
            "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source": "OpenStreetMap contributors (ODbL)",
            "boundary": boundary,
            "streets": dict(sorted(streets.items())),
        }
        os.makedirs("data", exist_ok=True)
        with open("data/streets.json", "w") as f:
            json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
        log("size", os.path.getsize("data/streets.json"), "bytes")
    except SystemExit as e:
        log("stopped:", e)
        raise
    finally:
        save_log()


if __name__ == "__main__":
    main()
