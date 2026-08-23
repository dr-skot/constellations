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
//     mirroring generateNextLesson() in course.js and recordSeen() in exposure.js.

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
// The constellations a given D* credits: renderable (`stars.length > 0`) and
// `diff ≤ dStar`; empty when `dStar ≤ 0`. The single source of truth for "what
// this D* unlocks" — both the seed write and the payoff count derive from it, so
// they can never drift apart.
function calibrationSeedTargets(catalog, dStar) {
  if (dStar <= 0) return [];
  return catalog.filter(c => c.stars && c.stars.length > 0 && c.diff <= dStar);
}

// Pure core: for every target constellation, mark its identify/diagram tier passed
// by lifting `seen` and `correct` to at least 1 (Math.max — an upward-only merge
// that never demotes real practice). Higher tiers are left untouched (earned
// through normal play), and `lastSeen` is DELIBERATELY never written: a seeded con
// must stay stale so heat keeps it hot and it surfaces in lesson 1 (writing `now`
// would bury it). `dStar ≤ 0` is a no-op. Mutates and returns `exposure`.
function applyCalibrationSeed(exposure, catalog, dStar) {
  for (const con of calibrationSeedTargets(catalog, dStar)) {
    const e = exposure[con.abbr] || (exposure[con.abbr] = {});
    const t = e['identify/diagram'] || (e['identify/diagram'] = { seen: 0, correct: 0 });
    t.seen    = Math.max(t.seen    || 0, 1);
    t.correct = Math.max(t.correct || 0, 1);
    // no t.lastSeen — see note above.
  }
  return exposure;
}

// ── Flow helpers (calibration screen, ticket #33) ──────────────────────────
// Pure pieces the standalone calibration flow is built from; the DOM wiring lives
// in js/calibration-ui.js. Kept here beside the scorer so they stay unit-testable.

// The ratified probe ladder (#27): one constellation per diff band 1→8, easy→hard.
const CALIBRATION_LADDER = ['Ori', 'Leo', 'Peg', 'Her', 'Cnc', 'Cet', 'CVn', 'Dor'];

// Resolve the ladder to real catalog cons. Each is renderable and its `diff`
// equals its band (Orion=1 … Dorado=8), which is what makes D* scoring by band
// (below) independent of the order the probes are shown in.
function calibrationProbes(catalog = C) {
  return CALIBRATION_LADDER
    .map(abbr => catalog.find(c => c.abbr === abbr))
    .filter(Boolean);
}

// Fisher–Yates, in place. `rng` defaults to Math.random so it is callable
// standalone; the UI threads real randomness in, tests thread a seeded rng.
// Shuffles the probe order and each probe's answer choices (the quiz's
// getDistractors supplies the distractors themselves).
function shuffleInPlace(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr;
}

// Score a finished calibration. `results` is one { diff, correct } per probe in ANY
// order; we fold them into a band-indexed hit array and defer to computeDStar, so a
// shuffled presentation yields the same D* as the ladder order. A band with no probe
// (shouldn't happen with the 8-probe ladder) counts as not-known.
function dStarFromProbeResults(results) {
  const byBand = new Array(8).fill(false);   // index k ↦ band k+1
  for (const r of results) {
    if (r.correct && r.diff >= 1 && r.diff <= 8) byBand[r.diff - 1] = true;
  }
  return computeDStar(byBand);
}

// Impure adapter: seed the live exposure against the real catalog C. Returns the written
// record. A re-run merges upward (Math.max), so calling it again with a lower D* never
// demotes. A destructive reset is a separate settings action (out of scope).
//
// The load-modify-save belongs to js/exposure.js — updateExposure brackets the edit
// between a read and a write, so nothing outside that module touches storage. What to
// change stays here, because "which constellations does D* credit" is level-check
// knowledge and the record has no business knowing what D* is.
function seedExposureFromCalibration(dStar) {
  return updateExposure(data => applyCalibrationSeed(data, C, dStar));
}
