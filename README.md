# ParkFree · Islington

Can I park here, now? A phone web app for Islington's 24 controlled parking zones, including Emirates Stadium event-day controls and the Resident Roamer scheme.

**Live:** https://ipancaldi.github.io/Parkfree/

## How it works
- Finds the street you're on (GPS, map tap or search) using OpenStreetMap.
- Zone comes from: a zone you confirmed for that street → streets verified from Islington pay-by-phone listings → an OpenStreetMap tag. If none, it asks you to read the zone letter on the CPZ sign once and remembers it on your device.
- Rules from Islington Council's CPZ, Emirates Stadium and Roamer pages (checked 26 Oct 2026). Always London time. Bank holidays from gov.uk.
- Events from Arsenal's local-residents fixture list (men's and women's). Add concerts in the Events tab.

The signs on the street always win: bay suspensions, yellow lines and loading bans are not modelled.

## Develop
Edit `src/app.html` (UI) or `src/logic.js` (rules), then:
```
python3 build.py      # writes index.html
node tests/rules.test.js
```
Free services used at runtime: OpenStreetMap Overpass & Nominatim, CARTO basemap tiles, gov.uk bank holidays.
