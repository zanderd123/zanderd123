# Quackdex

A phone-first web app for duck watchers:

- **Identify**: take or upload a photo and Claude names the species. It shows its
  confidence and the field marks it used, gives the species facts and a few fun
  facts, and suggests look-alikes. With no photo, the **field-mark matcher** ranks
  species by head colour, bill colour, size and region.
- **Directory**: all 135 living and recently extinct duck species plus 10 common
  domestic breeds. You can search, filter by group, region and IUCN status, and
  open a species card for its ID marks, habitat, diet, voice and size.
- **Map**: a **shared** sightings map. Tap anywhere, or pin a sighting straight from
  an identification. A sighting records the species, count, date and time, place,
  notes and a photo thumbnail. The location and time come from the photo's EXIF
  data when it has any.
- **Log**: your life list, stats and every sighting by month. You can switch
  between *Mine* and *Everyone*.

It's white with ocean blue, and an animated cartoon Mallard is the logo and
every loading screen.

## Running it

```
cd duck-app
node build.mjs
open dist/quackdex.html        # or double-click it
```

`dist/quackdex.html` is one self-contained file. Leaflet and the Google Fonts
load from CDNs, and everything else is inlined, including an offline world
basemap that shows when street tiles can't load. Host it on any static host
(GitHub Pages, Netlify) and "Add to Home Screen" on a phone to use it like an app.

## How the pieces work

| | Hosted as a claude.ai artifact | Standalone file / static host |
|---|---|---|
| Photo ID | Claude, through the viewer's own Claude account (`sample` capability). No key needed. | Claude API from the browser with the viewer's own Anthropic API key (Settings). The key stays in that browser's `localStorage`. Uses `claude-opus-5` with server-side refusal fallbacks enabled. |
| Sightings | **Shared map**: one `sightings` collection in the artifact's database (`db` + `user` capabilities). Everyone with edit access adds pins; names come from their Claude profile. | **This device only** (`localStorage`). A shared map needs a backend (below). |
| Location | Pick on the map, or from photo EXIF (the browser location API is blocked in artifacts) | Pick on the map, photo EXIF, or "Use my location" |

### Making the standalone map shared

Sightings go through a small store interface in `src/app.js`: `subscribe(cb)`,
`add(sighting)` and `remove(id)`. `localStore()` and `sharedStore(db)` are the two
implementations. To make a hosted copy shared, add a third one backed by
Firebase/Firestore, Supabase or your own API, and pass it to `useStore()` in
`boot()`. The sighting document shape is:

```js
{ id, speciesId, speciesName, count, seenAt, lat, lng, place, notes,
  photo /* ~20 KB JPEG data URL or null */, by /* user id */, createdAt }
```

For a public version, put photo ID behind your own server too, so you aren't
shipping an API key to browsers.

## Source layout

```
src/species.js      the directory: 145 entries, groups, regions, IUCN statuses
src/duck.js         the cartoon duck (logo, loaders, tinted species portraits)
src/app.js          app logic: identify, matcher, directory, map, sightings, log
src/styles.css      design tokens and all styles
src/shell.html      page markup
src/basemap.js      generated offline land + borders (tools/make-basemap.mjs)
src/leaflet.css     Leaflet 1.9.4 stylesheet, vendored
build.mjs           concatenates everything into dist/
```

`npm install && npm run basemap` regenerates `src/basemap.js` from Natural
Earth data (world-atlas).

## Prototype caveats

- Species facts, sizes and IUCN statuses were compiled for this prototype. Check
  them against a current field guide or the IUCN Red List before you rely on them.
- Directory portraits are cartoons tinted with each species' adult male colours,
  not illustrations of real plumage.
- On the shared map the app lets people delete only their own pins, but the
  database itself doesn't enforce that. Fine among friends; a public version
  needs server-side rules.
