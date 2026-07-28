// ═══════════════════════════════════════════════════════════
// LESSON PLANNER — pure scheduling core
// ═══════════════════════════════════════════════════════════
//
// planLesson(exposure, catalog, bounds, rng, now, log) → { label, questions }
// decides the next 12-question lesson from a snapshot of the learner's exposure.
// Pure and deterministic in its inputs: the same (exposure, rng, now) always
// yields the same lesson. All randomness enters through `rng` (a () → [0,1)
// function); the clock enters through `now`; every debug dump routes through the
// `log` sink. The impure adapter is generateNextLesson() in course.js, which
// supplies loadExposure(), C, BOUNDS, Math.random, Date.now(), console.
//
// The helpers below default rng → Math.random and log → the no-op SILENT sink so
// they remain callable standalone (e.g. from unit tests) with their original
// behavior; planLesson threads its own rng/log down explicitly.

const SILENT = { log() {}, table() {} };

function questionKey(q) {
  // Only photo has a real no-bounds tier distinction (find/photo vs find/photo-nb).
  // Diagram/stars noBounds is a display setting, not a separate tier.
  if (q.type === 'find' && q.noBounds && q.mode === 'photo') return 'find/photo-nb';
  if (q.type === 'find') return 'find/' + q.mode;
  return 'identify/' + q.mode;
}

// Linear tier progression per constellation.  Each tier unlocked by 1+ correct
// on the previous.  Within each tier, continuous knobs (choice→autocomplete for
// identify, starting distance for find) adapt based on accumulated correct count.
const TIER_SPECS = [
  ['identify/diagram', { type:'identify', mode:'diagram' }],
  ['find/diagram',     { type:'find',     mode:'diagram' }],
  ['identify/stars',   { type:'identify', mode:'stars' }],
  ['find/stars',       { type:'find',     mode:'stars' }],
  ['identify/photo',   { type:'identify', mode:'photo' }],
  ['find/photo',       { type:'find',     mode:'photo' }],
  ['find/photo-nb',    { type:'find',     mode:'photo', noBounds:true }],
];

// Return the first unpassed tier (the frontier).
function targetSpec(expCon) {
  const e = expCon || {};
  for (const [key, spec] of TIER_SPECS) {
    if ((e[key]?.correct ?? 0) < 1) return { ...spec, _tierKey: key };
  }
  const last = TIER_SPECS[TIER_SPECS.length - 1];
  return { ...last[1], _tierKey: last[0] };
}

// Pick a tier for review with exponential decay from frontier.
// Frontier ~58%, one below ~17%, two below ~5%, etc.
function reviewSpec(expCon, conName, rng = Math.random, log = SILENT) {
  const e = expCon || {};
  const passed = TIER_SPECS.filter(([key]) => (e[key]?.correct ?? 0) >= 1);
  if (passed.length === 0) return targetSpec(e);

  const frontier = targetSpec(e);
  const DECAY = 0.3;
  const pool = [{ spec: frontier, weight: 1.0, label: frontier._tierKey + ' (frontier)' }];
  for (let i = passed.length - 1; i >= 0; i--) {
    const dist = passed.length - i;
    pool.push({
      spec: { ...passed[i][1], _tierKey: passed[i][0] },
      weight: DECAY ** dist,
      label: passed[i][0]
    });
  }
  const total = pool.reduce((s, p) => s + p.weight, 0);
  let r = rng() * total;
  for (const p of pool) {
    r -= p.weight;
    if (r <= 0) {
      log.log(`[review] ${conName || '?'} passed:${passed.length} picked:${p.label} (${(p.weight/total*100).toFixed(0)}%)`);
      return p.spec;
    }
  }
  return pool[0].spec;
}

// Compute continuous difficulty knobs based on correct count within the tier.
// Returns a ready-to-use question spec (answerMode for identify, distanceLevel for find).
function applyKnobs(spec, expCon, conName, rng = Math.random, log = SILENT) {
  const e = expCon || {};
  const tierKey = spec._tierKey;
  const correct = e[tierKey]?.correct ?? 0;
  const out = { ...spec };
  delete out._tierKey;

  if (spec.type === 'identify') {
    const prob = Math.max(0, Math.min(1, (correct - 2) / 3));
    out.answerMode = rng() < prob ? 'autocomplete' : 'choice';
    log.log(`[knobs] ${conName || '?'} ${tierKey} correct:${correct} acProb:${prob.toFixed(2)} → ${out.answerMode}`);
  } else {
    out.distanceLevel = Math.min(1, correct / 6);
    if (spec.mode === 'diagram') out.noBounds = true;
    else if (spec.mode === 'stars') out.noBounds = false;
    if (spec.mode === 'photo' && !out.noBounds) out.noBounds = false;
    log.log(`[knobs] ${conName || '?'} ${tierKey} correct:${correct} distLevel:${out.distanceLevel.toFixed(2)} bounds:${!out.noBounds}`);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════
// HEAT MODEL — recency-based scheduling for review pool
// ═══════════════════════════════════════════════════════════
const HEAT_HALF_LIFE = 4;   // hours until staleness reaches 50%
const HEAT_JITTER = 0.1;    // random noise to vary ordering

function conHeat(con, exp, now, rng = Math.random) {
  const e = exp[con.abbr] || {};

  // Most recent practice across all tiers
  const timestamps = Object.values(e).map(v => v?.lastSeen || 0);
  const lastSeen = timestamps.length > 0 ? Math.max(...timestamps) : 0;
  const hoursSince = (now - lastSeen) / 3_600_000;

  // Staleness: 0 (just seen) → 1 (long ago), exponential rise
  const staleness = 1 - Math.exp(-hoursSince / HEAT_HALF_LIFE);

  // Tier urgency: higher for earlier frontier (more to learn)
  const tierIdx = TIER_SPECS.findIndex(([k]) => k === targetSpec(e)._tierKey);
  const urgency = 1 - tierIdx / TIER_SPECS.length;

  return staleness * (0.3 + 0.7 * urgency) + rng() * HEAT_JITTER;
}

function planLesson(exposure, catalog, bounds, rng = Math.random, now = Date.now(), log = SILENT) {
  const exp = exposure;
  log.log('[lesson] exposure keys:', Object.keys(exp).filter(k => k !== '_v2').length, 'constellations');
  const eligible = catalog.filter(c => c.stars.length > 0);

  // Split into known (seen at least once) and never-seen
  const known  = eligible.filter(c =>  (exp[c.abbr]?.['identify/diagram']?.seen || 0) > 0);
  const unseen = eligible.filter(c => !(exp[c.abbr]?.['identify/diagram']?.seen));
  log.log('[lesson] known:', known.length, 'unseen:', unseen.length);

  // New pool: diff:1 first, random within same diff
  const newPool = [...unseen].sort((a, b) => a.diff - b.diff || rng() - 0.5);

  // Review pool: sorted by heat (hottest first — stale + early-tier constellations
  // get priority over recently-practiced or advanced ones).
  const reviewPool = [...known]
    .map(con => ({ con, heat: conHeat(con, exp, now, rng) }))
    .sort((a, b) => b.heat - a.heat)
    .map(x => x.con);

  // Queue depth gating: a constellation is "in progress" until it reaches
  // identify/stars (tier 3). Cap in-progress at 5 + floor(known/10).
  // Under cap → introduce 1 new. At/over cap → consolidate first.
  let maxNew;
  if (known.length === 0) {
    maxNew = 4;
  } else {
    const inProgress = known.filter(c => {
      const e = exp[c.abbr] || {};
      // Not yet passed identify/stars → still in progress
      return (e['identify/stars']?.correct ?? 0) < 1;
    }).length;
    const cap = 5 + Math.floor(known.length / 10);
    maxNew = inProgress >= cap ? 0 : 1;
    log.log(`[lesson] inProgress: ${inProgress}, cap: ${cap}, maxNew: ${maxNew}`);
  }
  const actualNew = Math.min(maxNew, newPool.length);
  const reviewNeeded = 12 - actualNew;
  log.log('[lesson] maxNew:', maxNew, 'actualNew:', actualNew, 'reviewNeeded:', reviewNeeded);

  // Log per-constellation status for review pool
  log.table(reviewPool.map(con => {
    const e = exp[con.abbr] || {};
    const t = targetSpec(e);
    return {
      con: con.name,
      heat: conHeat(con, exp, now, rng).toFixed(2),
      frontier: t._tierKey,
      'id/dia': e['identify/diagram']?.correct || 0,
      'f/dia': e['find/diagram']?.correct || 0,
      'id/sta': e['identify/stars']?.correct || 0,
      'f/sta': e['find/stars']?.correct || 0,
      'id/pho': e['identify/photo']?.correct || 0,
      'f/pho': e['find/photo']?.correct || 0,
      'f/pho-nb': e['find/photo-nb']?.correct || 0,
    };
  }));

  const questions = [];

  // Review slots — use reviewSpec so passed tiers get revisited occasionally
  for (const con of reviewPool) {
    if (questions.length >= reviewNeeded) break;
    const spec = applyKnobs(reviewSpec(exp[con.abbr], con.name, rng, log), exp[con.abbr], con.name, rng, log);
    if (spec.type === 'find' && !bounds[con.abbr]) continue;
    questions.push({ con, ...spec });
  }

  // New slots
  let added = 0;
  for (const con of newPool) {
    if (added >= actualNew || questions.length >= 12) break;
    log.log('[lesson] new:', con.name, 'diff:', con.diff);
    questions.push({ con, type: 'identify', mode: 'diagram', answerMode: 'choice' });
    added++;
  }

  while (questions.length < 12 && questions.length > 0)
    questions.push({ ...questions[Math.floor(rng() * questions.length)] });

  questions.sort(() => rng() - 0.5);

  const newCount  = questions.filter(q => !(exp[q.con.abbr]?.['identify/diagram']?.seen)).length;
  const findCount = questions.filter(q => q.type === 'find').length;
  const label = newCount >= 6  ? 'New Constellations'
              : findCount >= 4 ? 'Sky Hunter'
              : newCount >= 2  ? 'Mixed Practice'
              : 'Review & Advance';

  log.log(`[lesson] FINAL: "${label}" ${questions.length}q (${newCount} new, ${findCount} find)`);
  log.table(questions.map((q, i) => ({
    '#': i, con: q.con.name, type: q.type, mode: q.mode,
    answer: q.answerMode || '-', noBounds: !!q.noBounds, distLevel: q.distanceLevel ?? '-'
  })));

  return { label, questions };
}
