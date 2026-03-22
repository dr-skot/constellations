# Constellation Data Sources

## Star positions: HYG v41 (Hipparcos)

- File: `hygdata_v41.csv`
- Source: [HYG Star Database v4.1](https://github.com/astronexus/HYG-Database)
- Hipparcos catalog positions with visual magnitudes and spectral types

## Diagram lines: IAU / Sky & Telescope

- File: `constellation_lines_iau.dat`
- Source: [dcf21/constellation-stick-figures](https://github.com/dcf21/constellation-stick-figures)
- Alan MacRobert's update of H.A. Rey's figures for Sky & Telescope magazine
- Used in official IAU/S&T educational materials (note: the IAU itself only defines
  constellation boundaries and star names, not stick figures)
- Format: Hipparcos star IDs in JSON arrays, one stroke per line
- Stars suffixed with `*` are borrowed from a neighboring constellation
- JS: `data.js` → `const C` (default diagram source)

## Diagram lines: H.A. Rey (1952)

- File: `constellation_lines_rey.dat`
- Source: [dcf21/constellation-stick-figures](https://github.com/dcf21/constellation-stick-figures)
- Original stick figures from H.A. Rey's *The Stars: A New Way to See Them* (1952)
- The only source with a published rationale — Rey designed figures to look like the
  things they represent, prioritizing recognizability over simplicity
- More elaborate than the IAU version; includes connections to faint stars (mag 5-6)
- JS: `rey-data.js` → `const REY`

## Diagram lines: Stellarium

- File: `stellarium-constellationship.fab`
- Stick figures from the [Stellarium](https://stellarium.org) planetarium software
- Created by contributor "xalioth"; no published design rationale — described by
  maintainers as "the Stellarium way" of drawing constellations
- Has evolved over time through community contributions
- Originally GPL2+, later relicensed to MIT by the author
  ([discussion](https://github.com/Stellarium/stellarium/discussions/790))
- Stellarium also ships a separate `modern_st` sky culture matching the IAU/S&T lines
  ([issue #3865](https://github.com/Stellarium/stellarium/issues/3865))
- JS: `stellarium-data.js` → `const SC`

## Diagram lines: Ford simplified

- File: `constellation_lines_simplified.dat`
- Source: [dcf21/constellation-stick-figures](https://github.com/dcf21/constellation-stick-figures)
- Dominic Ford's simplification for his [In-The-Sky.org](https://in-the-sky.org) planetarium
- Restricted to stars of 4th magnitude or brighter (except in faintest constellations)
- No published rationale beyond the brightness cutoff rule
- JS: `ford-data.js` → `const FORD`

## Comparing diagram sources

All four sources differ for most constellations. `data/compare_diagrams.py` compares
the Ford simplified set against Stellarium edge-by-edge. The explorer UI has a button
group to switch between IAU, Rey, Stellarium, and Ford in real time.

## Constellation artwork

- Source: Stellarium constellation art (Johan Meuris, CC BY-SA)
- Anchor data built by `/tmp/build_art.py` from Stellarium texture anchors + HYG catalog

## Naos in Pyxis

The IAU stick figure for Pyxis includes four stars: `α Pyx → γ Pyx → β Pyx → Naos*` (HIP 39429, marked as borrowed from Puppis). This preserves the historical mast of Argo Navis.

Ptolemy catalogued α, β, γ, and δ Pyxidis as stars on the mast of Argo Navis. When Lacaille created Pyxis (la Boussole) in the 1750s, he repurposed those mast stars as a new constellation. The mast line extended south to Naos (ζ Puppis), the bright star at its base.

In 1844, John Herschel proposed renaming Pyxis to **Malus** (Latin for "mast"), making it a fourth subdivision of Argo Navis alongside Carina, Puppis, and Vela. Francis Baily supported this, but Benjamin Gould restored Lacaille's naming, and the IAU ultimately adopted Pyxis.

The simplified stick figure version drops Naos and uses only the 3 stars within Pyxis proper. H.A. Rey kept Argo intact as a single constellation ("The Ship") in his 1952 book, so Pyxis doesn't appear separately in his original figures. The Naos extension in the IAU version appears to be MacRobert's choice to preserve the historical mast line.
