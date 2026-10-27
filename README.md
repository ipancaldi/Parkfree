# ParkFree · Islington

Can I park here, now? A phone web app for Islington's 24 controlled parking zones, including Emirates Stadium event-day controls and the Resident Roamer scheme.

**Live:** https://ipancaldi.github.io/Parkfree/

## How it works
- Finds the street you're on (GPS, map tap or search) using OpenStreetMap.
- Zone comes from: a zone you confirmed for that street → streets verified from Islington pay-by-phone listings → an OpenStreetMap tag. If none, it asks you to read the zone letter on the CPZ sign once and remembers it on your device.
- Rules from Islington Council's CPZ, Emirates Stadium and Roamer pages (checked 26 Oct 2026). Always London time. Bank holidays from gov.uk.
- Events from Arsenal's local-residents fixture list (men's and women's). Add concerts in the Events tab.

The signs on the street always win: bay suspensions, yellow lines and loading bans are not modelled.

## Features
- **Can I park here?** Verdict for your spot, your permit and Blue Badge, with today's timeline and the next 7 days.
- **Park here.** Saves your car, works out when to move it (paid stays, controls starting, event days) and adds a calendar reminder with a 15-minute alert.
- **Pay with RingGo.** Links to the RingGo location for the street when you need to pay.
- **Scan a sign.** Reads any parking or yellow suspension notice on the phone and remembers it for that spot.
- **Wrong answer?** Opens a prefilled GitHub issue with the street, time and what the app said.
- **Install it.** Add to Home Screen for a full-screen app that keeps working with a weak signal.

## Data, refreshed automatically
| File | Source | Refresh |
|---|---|---|
| `data/zones.json` | Islington's RingGo locations: zone, location code, max stay per street | monthly |
| `data/streets.json`, `data/bays.json` | OpenStreetMap roads, Islington boundary, mapped kerbside bays | monthly |
| `data/events.json` | Arsenal's local-residents fixture page | Mon and Thu |

Islington doesn't publish bay suspensions, so they come from signs you scan.

## Scan a sign
Tap the camera button and photograph a parking sign. The photo is read on the phone with Tesseract (bundled in `vendor/ocr`, nothing is uploaded). `src/sign.js` turns the text into zone, days, times and who can park, and checks it against your resident permit and Blue Badge.

## Develop
Edit `src/app.html` (UI), `src/logic.js` (zone rules) or `src/sign.js` (sign reader), then:
```
python3 build.py      # writes index.html
node tests/rules.test.js
node tests/sign.test.js
```
Free services used at runtime: OpenStreetMap Overpass & Nominatim, CARTO basemap tiles, gov.uk bank holidays.
