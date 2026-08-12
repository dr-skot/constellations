// ═══════════════════════════════════════════════════════════
// CALIBRATION ENGINE — the optional up-front "level check"
// ═══════════════════════════════════════════════════════════
//
// The level check is a short identification calibration (~8 probes, one per diff
// band) that seeds a returning learner's `exposure` so they skip the
// one-new-per-lesson introduction grind. This file is the pure scoring + seeding
// core (issue #32, spec #26); the UI flow is built separately.
//
// Two pieces:
//   • computeDStar(correct)  — pure scorer → the known-difficulty threshold D*.
//   • applyCalibrationSeed(exposure, catalog, dStar) — pure seeding core.
//   • seedExposureFromCalibration(dStar) — the impure load→seed→save adapter,
//     mirroring generateNextLesson()/recordSeen() in course.js.

// ── D* scoring: best-separator / step-fit (decision #28) ───────────────────
// Given the 8 per-band probe results (`correct[k]` = band k+1 answered right),
// return the known-difficulty threshold D* in 0..8: the band split that best
// separates the reliably-known easy bands from the unknown hard ones. 0 ⇒ start
// at zero (all wrong); 8 ⇒ credit all bands (all right). The error at a candidate
// split b is (misses in bands ≤ b) + (hits in bands > b); D* is the b that
// minimises it. A strict `<` on the running best keeps the LOWER b on ties (the
// conservative choice) — which also forgives a lone low slip (stepping over it
// costs 1) and ignores a lone lucky high guess (crediting up to it costs more).
function computeDStar(correct) {
  const n = correct.length;                 // number of bands (8)
  let bestB = 0, bestErr = Infinity;
  for (let b = 0; b <= n; b++) {
    let err = 0;
    for (let k = 0; k < n; k++) {
      const band = k + 1;
      if (band <= b) { if (!correct[k]) err++; }   // a band we credit but got wrong
      else           { if (correct[k])  err++; }   // a band we don't credit but got right
    }
    if (err < bestErr) { bestErr = err; bestB = b; }
  }
  return bestB;
}

// ── Exposure seeding (decision #29) ────────────────────────────────────────
// Pure core: for every renderable constellation (`stars.length > 0`) with
// `diff ≤ dStar`, mark its identify/diagram tier passed by lifting `seen` and
// `correct` to at least 1 (Math.max — an upward-only merge that never demotes
// real practice). Higher tiers are left untouched (earned through normal play),
// and `lastSeen` is DELIBERATELY never written: a seeded con must stay stale so
// heat keeps it hot and it surfaces in lesson 1 (writing `now` would bury it).
// `dStar ≤ 0` is a no-op. Mutates and returns `exposure`.
function applyCalibrationSeed(exposure, catalog, dStar) {
  if (dStar <= 0) return exposure;
  for (const con of catalog) {
    if (!con.stars || con.stars.length === 0) continue;   // non-renderable → skip
    if (con.diff > dStar) continue;                        // above the threshold → skip
    const e = exposure[con.abbr] || (exposure[con.abbr] = {});
    const t = e['identify/diagram'] || (e['identify/diagram'] = { seen: 0, correct: 0 });
    t.seen    = Math.max(t.seen    || 0, 1);
    t.correct = Math.max(t.correct || 0, 1);
    // no t.lastSeen — see note above.
  }
  return exposure;
}

// Impure adapter: load the live exposure, seed it against the real catalog C,
// and persist. Returns the written exposure. localStorage-only and session-safe;
// a re-run merges upward (Math.max), so calling it again with a lower D* never
// demotes. A destructive reset is a separate settings action (out of scope).
function seedExposureFromCalibration(dStar) {
  const data = loadExposure();
  applyCalibrationSeed(data, C, dStar);
  saveExposure(data);
  return data;
}
