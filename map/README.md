# The city map goes here

One file lives in this folder:

    map/city-dark.webp

It's used on the **landing page** (`js/landing-map.js`): the illustration is
drawn full-width with a dim, static ring over each real ward's island, no
names or counts — just "something is here, and it's dark." The island
coordinates are hand-placed in `js/city-map.js`'s `ISLANDS` constant, exported
from there so both files share one source of truth.

The **in-game World screen** does *not* use this image — it draws its own
per-district skyline (`js/ward-tiles.js` + `js/ward-profiles.js`), lit
building-by-building as districts restore. `js/city-map.js` also still has
`renderArtOverlay`/`renderCityMap`, an earlier illustrated/schematic overlay
design for the World screen, but nothing imports it — it's unused, kept only
because `ISLANDS` lives in that file.

## What the image has to be

**Dark and unlit.** This is the one requirement that matters. The landing
page draws it exactly as-is, without any lightening/lit-window mechanic, so if
the art arrives with glowing streets already baked in, it stays that way.

| | |
|---|---|
| Format | `.webp` |
| Size | 1672×941 (viewBox math in `city-map.js` — `CITY_H_ART` — assumes this) |
| Aspect | roughly 100:56.3 — wider than tall |
| Mood | night, before the power came back |

## Prompt that produces the right thing

> Top-down isometric city at night, fully dark and unlit. No glowing windows,
> no lit streets, no light sources. Muted indigo and slate blue. Distinct
> neighbourhood blocks separated by rivers, roads and bridges. Flat ambient
> lighting, high angle, no people, no text. Game map asset.

Add "no lit windows, no neon, no glow" to the negative prompt if the tool takes
one — image models reach for a lit night city by default and it takes saying so
more than once.

## If the artwork changes

`ISLANDS` in `js/city-map.js` was hand-placed against *this specific* image's
nine islands. A new image needs those coordinates retuned to match, and
`landing-map.js`'s marker count/skip logic (it drops the leafy park island,
index 4) re-checked against the new layout.
