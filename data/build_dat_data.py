#!/usr/bin/env python3
"""Convert a dcf21 constellation_lines_*.dat file → a JS data file.

Usage:
  python3 build_dat_data.py <input.dat> <output.js> <JS_VAR_NAME> <header_comment>

Examples:
  python3 build_dat_data.py constellation_lines_simplified.dat ../js/ford-data.js FORD "Ford simplified"
  python3 build_dat_data.py constellation_lines_rey.dat ../js/rey-data.js REY "H.A. Rey (1952)"
"""

import csv, json, re, math, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")

if len(sys.argv) < 5:
    print(__doc__)
    sys.exit(1)

input_dat = os.path.join(DATA, sys.argv[1])
output_js = sys.argv[2] if os.path.isabs(sys.argv[2]) else os.path.join(ROOT, "js", sys.argv[2])
js_var = sys.argv[3]
header_comment = sys.argv[4]

# ── 1. Load HYG catalog keyed by HIP ID ──────────────────────────
hyg = {}
with open(os.path.join(DATA, "hygdata_v41.csv"), "r") as f:
    for row in csv.DictReader(f):
        hip = row["hip"].strip()
        if hip:
            hyg[int(hip)] = row

# ── 2. Parse .dat file ───────────────────────────────────────────
DAT_NAME_TO_ABBR = {
    "Andromeda": "And", "Antlia": "Ant", "Apus": "Aps", "Aquarius": "Aqr",
    "Aquila": "Aql", "Ara": "Ara", "Aries": "Ari", "Auriga": "Aur",
    "Bootes": "Boo", "Caelum": "Cae", "Camelopardalis": "Cam",
    "Cancer": "Cnc", "CanesVenatici": "CVn", "CanisMajor": "CMa",
    "CanisMinor": "CMi", "Capricornus": "Cap", "Carina": "Car",
    "Cassiopeia": "Cas", "Centaurus": "Cen", "Cepheus": "Cep",
    "Cetus": "Cet", "Chamaeleon": "Cha", "Circinus": "Cir",
    "Columba": "Col", "ComaBerenices": "Com", "CoronaAustralis": "CrA",
    "CoronaBorealis": "CrB", "Corvus": "Crv", "Crater": "Crt",
    "Crux": "Cru", "Cygnus": "Cyg", "Delphinus": "Del", "Dorado": "Dor",
    "Draco": "Dra", "Equuleus": "Equ", "Eridanus": "Eri", "Fornax": "For",
    "Gemini": "Gem", "Grus": "Gru", "Hercules": "Her",
    "Horologium": "Hor", "Hydra": "Hya", "Hydrus": "Hyi", "Indus": "Ind",
    "Lacerta": "Lac", "Leo": "Leo", "LeoMinor": "LMi", "Lepus": "Lep",
    "Libra": "Lib", "Lupus": "Lup", "Lynx": "Lyn", "Lyra": "Lyr",
    "Mensa": "Men", "Microscopium": "Mic", "Monoceros": "Mon",
    "Musca": "Mus", "Norma": "Nor", "Octans": "Oct", "Ophiuchus": "Oph",
    "Orion": "Ori", "Pavo": "Pav", "Pegasus": "Peg", "Perseus": "Per",
    "Phoenix": "Phe", "Pictor": "Pic", "Pisces": "Psc",
    "PiscisAustrinus": "PsA", "Puppis": "Pup", "Pyxis": "Pyx",
    "Reticulum": "Ret", "Sagitta": "Sge", "Sagittarius": "Sgr",
    "Scorpius": "Sco", "Sculptor": "Scl", "Scutum": "Sct",
    "SerpensA": "Ser", "SerpensB": "Ser", "Sextans": "Sex",
    "Taurus": "Tau", "Telescopium": "Tel", "Triangulum": "Tri",
    "TriangulumAustrale": "TrA", "Tucana": "Tuc", "UrsaMajor": "UMa",
    "UrsaMinor": "UMi", "Vela": "Vel", "Virgo": "Vir", "Volans": "Vol",
    "Vulpecula": "Vul",
}

dat = {}
with open(input_dat, "r") as f:
    current_abbr = None
    for line in f:
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('* '):
            name = line[2:].strip()
            current_abbr = DAT_NAME_TO_ABBR.get(name)
            if current_abbr and current_abbr not in dat:
                dat[current_abbr] = []
            continue
        if current_abbr and line.startswith('['):
            stars = [s.rstrip('*') for s in json.loads(line)]
            for i in range(len(stars) - 1):
                dat[current_abbr].append((int(stars[i]), int(stars[i + 1])))

# ── 3. Parse our data.js for per-constellation metadata ──────────
meta = {}
with open(os.path.join(ROOT, "js", "data.js"), "r") as f:
    text = f.read()
for m in re.finditer(
    r'name:\s*"([^"]+)",\s*abbr:\s*"([^"]+)",\s*hem:\s*"([^"]+)",\s*diff:\s*(\d+)'
    r'(?:,\s*meaning:\s*"([^"]+)")?',
    text,
):
    meta[m.group(2)] = {
        "name": m.group(1),
        "abbr": m.group(2),
        "hem": m.group(3),
        "diff": int(m.group(4)),
        "meaning": m.group(5) or "",
    }

# ── 4. Color hint from B-V index ─────────────────────────────────
def color_hint(ci_str):
    try:
        ci = float(ci_str)
    except (ValueError, TypeError):
        return None
    if ci < 0.0:
        return "b"
    if ci > 1.2:
        return "r"
    if ci > 0.8:
        return "o"
    return None

# ── 5. Compute center RA/Dec and FOV ─────────────────────────────
def compute_framing(stars):
    if not stars:
        return (0, 0, 10)
    decs = [s[1] for s in stars]
    sx = sum(math.cos(math.radians(s[0])) for s in stars)
    sy = sum(math.sin(math.radians(s[0])) for s in stars)
    ra_c = math.degrees(math.atan2(sy, sx)) % 360
    dec_c = sum(decs) / len(decs)
    max_sep = 0
    for s in stars:
        dra = (s[0] - ra_c + 180) % 360 - 180
        ddec = s[1] - dec_c
        sep = math.sqrt((dra * math.cos(math.radians(dec_c))) ** 2 + ddec ** 2)
        max_sep = max(max_sep, sep)
    fov = round(max_sep * 2 * 1.3, 1)
    fov = max(fov, 5.0)
    return (round(ra_c, 1), round(dec_c, 1), fov)

# ── 6. Build entries ─────────────────────────────────────────────
entries = []
missing_meta = []
missing_hip = set()

for abbr in sorted(dat.keys()):
    segments = dat[abbr]
    if abbr not in meta:
        missing_meta.append(abbr)
        continue

    seen = {}
    ordered_hips = []
    for h1, h2 in segments:
        for h in (h1, h2):
            if h not in seen:
                seen[h] = len(ordered_hips)
                ordered_hips.append(h)

    stars = []
    hip_to_idx = {}
    for i, h in enumerate(ordered_hips):
        if h not in hyg:
            missing_hip.add(h)
            continue
        row = hyg[h]
        ra_deg = round(float(row["ra"]) * 15, 6)
        dec_deg = round(float(row["dec"]), 6)
        mag = round(float(row["mag"]), 1)
        ch = color_hint(row["ci"])
        proper = row["proper"].strip()
        star = [ra_deg, dec_deg, mag]
        if ch:
            star.append(ch)
        elif proper:
            star.append(None)
        if proper:
            star.append(proper)
        hip_to_idx[h] = len(stars)
        stars.append(star)

    lines = []
    for h1, h2 in segments:
        if h1 in hip_to_idx and h2 in hip_to_idx:
            lines.append([hip_to_idx[h1], hip_to_idx[h2]])

    ra_c, dec_c, fov = compute_framing(stars)

    m = meta[abbr]
    entry = {
        "name": m["name"],
        "abbr": m["abbr"],
        "hem": m["hem"],
        "diff": m["diff"],
    }
    if m["meaning"]:
        entry["meaning"] = m["meaning"]
    entry["ra"] = ra_c
    entry["dec"] = dec_c
    entry["fov"] = fov
    entry["stars"] = stars
    entry["lines"] = lines
    entries.append(entry)

# ── 7. Write output ──────────────────────────────────────────────
def fmt_star(s):
    parts = [str(s[0]), str(s[1]), str(s[2])]
    if len(s) > 3:
        parts.append("null" if s[3] is None else f"'{s[3]}'")
    if len(s) > 4:
        parts.append(f"'{s[4]}'")
    return "[" + ", ".join(parts) + "]"

def fmt_line(l):
    return f"[{l[0]}, {l[1]}]"

with open(output_js, "w") as f:
    f.write("// ═══════════════════════════════════════════════════════════\n")
    f.write(f"// {header_comment} — stars: [ra_deg, dec_deg, mag, colorHint?, name?]\n")
    f.write(f"// Source: {os.path.basename(input_dat)} + HYG v41 catalog\n")
    f.write("// https://github.com/dcf21/constellation-stick-figures\n")
    f.write("// ═══════════════════════════════════════════════════════════\n")
    f.write(f"const {js_var} = [\n")
    for i, e in enumerate(entries):
        meaning = f', meaning: "{e["meaning"]}"' if e.get("meaning") else ""
        f.write(f'  {{\n')
        f.write(f'    name: "{e["name"]}", abbr: "{e["abbr"]}", hem: "{e["hem"]}", diff: {e["diff"]}{meaning}, ra: {e["ra"]}, dec: {e["dec"]}, fov: {e["fov"]},\n')
        star_strs = ", ".join(fmt_star(s) for s in e["stars"])
        f.write(f"    stars: [{star_strs}],\n")
        line_strs = ", ".join(fmt_line(l) for l in e["lines"])
        f.write(f"    lines: [{line_strs}]\n")
        comma = "," if i < len(entries) - 1 else ""
        f.write(f"  }}{comma}\n\n")
    f.write("];\n")

print(f"Wrote {len(entries)} constellations to {output_js}")
if missing_meta:
    print(f"Skipped (no metadata): {missing_meta}")
if missing_hip:
    print(f"Missing HIP IDs in HYG: {sorted(missing_hip)}")
