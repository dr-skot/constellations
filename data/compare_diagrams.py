#!/usr/bin/env python3
"""Compare constellation stick figures: IAU simplified vs Stellarium.

Parses constellation_lines_simplified.dat and stellarium-constellationship.fab,
converts both to sets of undirected edges (Hipparcos ID pairs), and reports
differences per constellation.
"""

import json, re, sys, os

DIR = os.path.dirname(os.path.abspath(__file__))

# --- Parse simplified dat (dcf21 format) ---
def parse_simplified(path):
    cons = {}
    name = None
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if line.startswith('* '):
                name = line[2:].strip()
                cons[name] = set()
                continue
            if name and line.startswith('['):
                stars = [s.rstrip('*') for s in json.loads(line)]
                for i in range(len(stars) - 1):
                    edge = tuple(sorted([stars[i], stars[i+1]]))
                    cons[name].add(edge)
    return cons

# --- Parse stellarium constellationship.fab ---
def parse_stellarium(path):
    cons = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            parts = line.split()
            abbr = parts[0]
            n_edges = int(parts[1])
            hip_ids = parts[2:]
            edges = set()
            for i in range(0, len(hip_ids) - 1, 2):
                edge = tuple(sorted([hip_ids[i], hip_ids[i+1]]))
                edges.add(edge)
            cons[abbr] = edges
    return cons

# --- IAU 3-letter abbreviation to full name mapping ---
# (needed because the dat file uses full names, fab uses abbreviations)
IAU_ABBR = {
    "And": "Andromeda", "Ant": "Antlia", "Aps": "Apus", "Aqr": "Aquarius",
    "Aql": "Aquila", "Ara": "Ara", "Ari": "Aries", "Aur": "Auriga",
    "Boo": "Bootes", "Cae": "Caelum", "Cam": "Camelopardalis",
    "Cnc": "Cancer", "CVn": "Canes Venatici", "CMa": "Canis Major",
    "CMi": "Canis Minor", "Cap": "Capricornus", "Car": "Carina",
    "Cas": "Cassiopeia", "Cen": "Centaurus", "Cep": "Cepheus",
    "Cet": "Cetus", "Cha": "Chamaeleon", "Cir": "Circinus",
    "Col": "Columba", "Com": "Coma Berenices", "CrA": "Corona Australis",
    "CrB": "Corona Borealis", "Crv": "Corvus", "Crt": "Crater",
    "Cru": "Crux", "Cyg": "Cygnus", "Del": "Delphinus", "Dor": "Dorado",
    "Dra": "Draco", "Equ": "Equuleus", "Eri": "Eridanus", "For": "Fornax",
    "Gem": "Gemini", "Gru": "Grus", "Her": "Hercules",
    "Hor": "Horologium", "Hya": "Hydra", "Hyi": "Hydrus", "Ind": "Indus",
    "Lac": "Lacerta", "Leo": "Leo", "LMi": "Leo Minor", "Lep": "Lepus",
    "Lib": "Libra", "Lup": "Lupus", "Lyn": "Lynx", "Lyr": "Lyra",
    "Men": "Mensa", "Mic": "Microscopium", "Mon": "Monoceros",
    "Mus": "Musca", "Nor": "Norma", "Oct": "Octans", "Oph": "Ophiuchus",
    "Ori": "Orion", "Pav": "Pavo", "Peg": "Pegasus", "Per": "Perseus",
    "Phe": "Phoenix", "Pic": "Pictor", "Psc": "Pisces",
    "PsA": "Piscis Austrinus", "Pup": "Puppis", "Pyx": "Pyxis",
    "Ret": "Reticulum", "Sge": "Sagitta", "Sgr": "Sagittarius",
    "Sco": "Scorpius", "Scl": "Sculptor", "Sct": "Scutum",
    "Ser": "Serpens", "Sex": "Sextans", "Tau": "Taurus",
    "Tel": "Telescopium", "Tri": "Triangulum", "TrA": "Triangulum Australe",
    "Tuc": "Tucana", "UMa": "Ursa Major", "UMi": "Ursa Minor",
    "Vel": "Vela", "Vir": "Virgo", "Vol": "Volans", "Vul": "Vulpecula",
}
NAME_TO_ABBR = {v: k for k, v in IAU_ABBR.items()}

# Map dat-file names (no spaces, SerpensA/B) to canonical full names
DAT_NAME_MAP = {v.replace(' ', ''): v for v in IAU_ABBR.values()}
DAT_NAME_MAP['SerpensA'] = 'Serpens'
DAT_NAME_MAP['SerpensB'] = 'Serpens'

# --- Load both ---
raw_simplified = parse_simplified(os.path.join(DIR, 'constellation_lines_simplified.dat'))
stellarium_raw = parse_stellarium(os.path.join(DIR, 'stellarium-constellationship.fab'))

# Normalize simplified names and merge SerpensA+B
simplified = {}
for dat_name, edges in raw_simplified.items():
    canon = DAT_NAME_MAP.get(dat_name, dat_name)
    if canon in simplified:
        simplified[canon] |= edges  # merge SerpensA + SerpensB
    else:
        simplified[canon] = set(edges)

# Map stellarium abbreviations to full names
stel_by_name = {}
for abbr, edges in stellarium_raw.items():
    name = IAU_ABBR.get(abbr, abbr)
    stel_by_name[name] = edges

# --- Compare ---
all_names = sorted(set(simplified.keys()) | set(stel_by_name.keys()))

identical = 0
different = 0
only_simplified = 0
only_stellarium = 0

for name in all_names:
    s = simplified.get(name, set())
    t = stel_by_name.get(name, set())
    abbr = NAME_TO_ABBR.get(name, "???")

    if not s and t:
        only_stellarium += 1
        print(f"\n{name} ({abbr}): ONLY IN STELLARIUM ({len(t)} edges)")
        continue
    if s and not t:
        only_simplified += 1
        print(f"\n{name} ({abbr}): ONLY IN SIMPLIFIED ({len(s)} edges)")
        continue

    if s == t:
        identical += 1
        continue

    different += 1
    only_in_s = s - t
    only_in_t = t - s
    shared = s & t
    print(f"\n{name} ({abbr}): DIFFERENT — {len(shared)} shared, "
          f"+{len(only_in_s)} simplified-only, +{len(only_in_t)} stellarium-only")
    if only_in_s:
        print(f"  Simplified only: {sorted(only_in_s)}")
    if only_in_t:
        print(f"  Stellarium only: {sorted(only_in_t)}")

print(f"\n{'='*60}")
print(f"Total: {len(all_names)} constellations")
print(f"  Identical:         {identical}")
print(f"  Different:         {different}")
print(f"  Only simplified:   {only_simplified}")
print(f"  Only stellarium:   {only_stellarium}")
