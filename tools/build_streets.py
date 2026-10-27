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
Q_BAYS = f"""[out:json][timeout:120];
(
  way({BBOX})["highway"]["parking:both"];
  way({BBOX})["highway"]["parking:left"];
  way({BBOX})["highway"]["parking:right"];
  way({BBOX})["highway"]["parking:lane:both"];
  way({BBOX})["highway"]["parking:lane:left"];
  way({BBOX})["highway"]["parking:lane:right"];
  nwr({BBOX})["amenity"="parking"]["parking"~"^(street_side|lane|on_kerb|half_on_kerb)$"];
  nwr({BBOX})["amenity"="parking_space"];
);
out tags geom;"""
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
        for attempt in range(3 if ep == ENDPOINTS[0] else 1):
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
                time.sleep(30 if "50" in str(e) else 8)
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


NO = {"no", "separate", "no_parking", "no_stopping", "no_standing", "fire_lane", "marked"}


def side_info(tags, side):
    """Return (present, kind) for one side of a street, from current or legacy OSM parking tags."""
    v = tags.get(f"parking:{side}") or tags.get("parking:both") or tags.get(f"parking:lane:{side}") or tags.get("parking:lane:both")
    if not v or v in NO:
        return None
    r = " ".join(filter(None, [
        tags.get(f"parking:{side}:restriction"), tags.get("parking:both:restriction"),
        tags.get(f"parking:{side}:access"), tags.get("parking:both:access"),
        tags.get(f"parking:condition:{side}"), tags.get("parking:condition:both"),
        tags.get(f"parking:{side}:fee"), tags.get("parking:both:fee"),
    ])).lower()
    if any(x in r for x in ("no_parking", "no_stopping", "no_standing")):
        return None
    if "disabled" in r:
        return "disabled"
    if "loading" in r or "delivery" in r:
        return "loading"
    if "customers" in r or "private" in r:
        return "private"
    return "bay"


def build_bays(d):
    kerbs, areas, spaces = [], [], []
    for e in d.get("elements", []):
        t = e.get("tags", {})
        g = e.get("geometry")
        if e.get("type") == "way" and t.get("highway") and g:
            pts = flat(simplify([(p["lat"], p["lon"]) for p in g], 0.00001))
            for side in ("left", "right"):
                k = side_info(t, side)
                if k:
                    kerbs.append({"s": "l" if side == "left" else "r", "k": k, "n": t.get("name", ""), "g": pts})
        elif t.get("amenity") == "parking" and g:
            pts = flat([(p["lat"], p["lon"]) for p in g])
            a = (t.get("access", "") + " " + t.get("parking_space", "")).lower()
            areas.append({"k": "disabled" if "disabled" in a else "private" if ("private" in a or "customers" in a) else "bay",
                          "cap": t.get("capacity"), "g": pts})
        elif t.get("amenity") == "parking_space":
            c = e.get("center") or (g[0] if g else None) or ({"lat": e["lat"], "lon": e["lon"]} if "lat" in e else None)
            if c:
                kind = (t.get("parking_space") or "").lower()
                spaces.append({"k": "disabled" if kind == "disabled" else "loading" if kind in ("delivery", "loading") else "bay",
                               "p": [round(c["lat"], 5), round(c["lon"], 5)]})
    return kerbs, areas, spaces


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
    ok = False
    try:
        # Bays first: smaller query, and useful even if the street refresh fails
        bd = fetch(Q_BAYS, "bays")
        if bd:
            kerbs, areas, spaces = build_bays(bd)
            from collections import Counter
            named = len({k["n"] for k in kerbs if k["n"]})
            log(f"bays: {len(kerbs)} kerb sides on {named} named streets {dict(Counter(k['k'] for k in kerbs))}, "
                f"{len(areas)} parking areas, {len(spaces)} single spaces {dict(Counter(x['k'] for x in spaces))}")
            os.makedirs("data", exist_ok=True)
            with open("data/bays.json", "w") as f:
                json.dump({"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                           "source": "OpenStreetMap contributors (ODbL)", "kerbs": kerbs, "areas": areas, "spaces": spaces},
                          f, separators=(",", ":"), ensure_ascii=False)
            log("bays size", os.path.getsize("data/bays.json"), "bytes")
            ok = True
        d = fetch(Q_STREETS, "streets")
        if not d:
            log("streets: all servers failed; keeping the existing street map")
        else:
            b = fetch(Q_BOUNDARY, "boundary") or {"elements": []}
            streets, _ = build(d)
            rels = [e for e in b.get("elements", []) if e.get("type") == "relation" and "Islington" in e.get("tags", {}).get("name", "")]
            boundary = [flat(simplify(r, 0.00005)) for r in rings(rels[0])] if rels else []
            log(f"{len(streets)} named streets, {len(boundary)} boundary rings")
            if len(streets) >= 300 and boundary:
                with open("data/streets.json", "w") as f:
                    json.dump({"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                               "source": "OpenStreetMap contributors (ODbL)", "boundary": boundary,
                               "streets": dict(sorted(streets.items()))}, f, separators=(",", ":"), ensure_ascii=False)
                log("size", os.path.getsize("data/streets.json"), "bytes")
                ok = True
            else:
                log("streets: result incomplete; keeping the existing street map")
        if not ok:
            sys.exit("Nothing updated")
    except SystemExit as e:
        log("stopped:", e)
        raise
    finally:
        save_log()


if __name__ == "__main__":
    main()
