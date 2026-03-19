#!/usr/bin/env python3
"""Convert stellarium-constellationship.fab → js/stellarium-data.js
using HYG v41 catalog for star positions and our data.js for metadata."""

import csv, re, math, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")

# ── 1. Load HYG catalog keyed by HIP ID ──────────────────────────
hyg = {}
with open(os.path.join(DATA, "hygdata_v41.csv"), "r") as f:
    for row in csv.DictReader(f):
        hip = row["hip"].strip()
        if hip:
            hyg[int(hip)] = row

# ── 2. Parse .fab file ────────────────────────────────────────────
fab = {}
with open(os.path.join(DATA, "stellarium-constellationship.fab"), "r") as f:
    for line in f:
        parts = line.split()
        if len(parts) < 4:
            continue
        abbr = parts[0]
        nums = [int(x) for x in parts[2:]]
        segments = [(nums[i], nums[i + 1]) for i in range(0, len(nums), 2)]
        fab[abbr] = segments

# ── 3. Parse our data.js for per-constellation metadata ──────────
meta = {}
with open(os.path.join(ROOT, "js", "data.js"), "r") as f:
    text = f.read()
# match each constellation object's opening line
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
    """Return (ra_center, dec_center, fov) for a set of [ra, dec, ...] stars."""
    if not stars:
        return (0, 0, 10)
    decs = [s[1] for s in stars]
    # circular mean for RA (handles 0/360 wrap)
    sx = sum(math.cos(math.radians(s[0])) for s in stars)
    sy = sum(math.sin(math.radians(s[0])) for s in stars)
    ra_c = math.degrees(math.atan2(sy, sx)) % 360
    dec_c = sum(decs) / len(decs)
    # FOV: max angular distance from center to any star, × 2 + margin
    max_sep = 0
    for s in stars:
        dra = (s[0] - ra_c + 180) % 360 - 180
        ddec = s[1] - dec_c
        sep = math.sqrt((dra * math.cos(math.radians(dec_c))) ** 2 + ddec ** 2)
        max_sep = max(max_sep, sep)
    fov = round(max_sep * 2 * 1.3, 1)  # 30% margin
    fov = max(fov, 5.0)  # minimum 5°
    return (round(ra_c, 1), round(dec_c, 1), fov)

# ── 6. Build stellarium-data.js ───────────────────────────────────
entries = []
missing_meta = []
missing_hip = set()

for abbr, segments in sorted(fab.items()):
    if abbr not in meta:
        missing_meta.append(abbr)
        continue

    # Collect unique HIP IDs in order of first appearance
    seen = {}
    ordered_hips = []
    for h1, h2 in segments:
        for h in (h1, h2):
            if h not in seen:
                seen[h] = len(ordered_hips)
                ordered_hips.append(h)

    # Build stars array
    stars = []
    hip_to_idx = {}
    for i, h in enumerate(ordered_hips):
        if h not in hyg:
            missing_hip.add(h)
            continue
        row = hyg[h]
        ra_deg = round(float(row["ra"]) * 15, 6)  # hours → degrees
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

    # Build lines array (skip if either star was missing from HYG)
    lines = []
    for h1, h2 in segments:
        if h1 in hip_to_idx and h2 in hip_to_idx:
            lines.append([hip_to_idx[h1], hip_to_idx[h2]])

    # Compute framing from star positions
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

out_path = os.path.join(ROOT, "js", "stellarium-data.js")
with open(out_path, "w") as f:
    f.write("// ═══════════════════════════════════════════════════════════\n")
    f.write("// STELLARIUM WEB line data — stars: [ra_deg, dec_deg, mag, colorHint?, name?]\n")
    f.write("// Source: stellarium-constellationship.fab + HYG v41 catalog\n")
    f.write("// ═══════════════════════════════════════════════════════════\n")
    f.write("const SC = [\n")
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

print(f"Wrote {len(entries)} constellations to {out_path}")
if missing_meta:
    print(f"Skipped (no metadata): {missing_meta}")
if missing_hip:
    print(f"Missing HIP IDs in HYG: {sorted(missing_hip)}")
