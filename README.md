# ParkFree · Islington

Can I park here, now? A phone web app for Islington's 24 controlled parking zones, including Emirates Stadium event-day controls and the Resident Roamer scheme.

**Live:** https://ipancaldi.github.io/Parkfree/

## How it works
- Finds the street you're on (GPS, map tap or search) using OpenStreetMap.
- Zone comes from: a zone you confirmed for that street → streets verified from Islington pay-by-phone listings → an OpenStreetMap tag. If none, it asks you to read the zone letter on the CPZ sign once and remembers it on your device.
- Rules from Islington Council's CPZ, Emirates Stadium and Roamer pages (checked 26 Oct 2026). Always London time. Bank holidays from gov.uk.
- Events from Arsenal's local-residents fixture list (men's and women's). Add concerts in the Events tab.

The signs on the street always win: bay suspensions, yellow lines and loading bans are not modelled.

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
