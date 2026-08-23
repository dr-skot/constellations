// js/guide-source.js
// The GUIDE SOURCE: the one place a finding guide is loaded, prepared and validated.
//
// Before this, the pipeline was open-coded twice — js/find-guide.js and an inline
// <script> in find-help.html — and the second copy fetched outside the ?v= cache-stamp
// fence, because test/cache-stamp.js could only see js/*.js (#83, #84).
//
// fetch is INJECTED at initGuideSource, the same shape initRouter and planLesson use.
// That is what puts the whole module under node: the cache, the null path, the rejection
// path, the random fill, the roll and the schema gate all run against a fake.

let _fetch    = null;
let _inFlight = null;   // Promise of { guides, catalog }, or null

// Both hosts call this at boot. Resetting the caches makes the module re-initialisable,
// which is what lets one test file run many scenarios.
function initGuideSource({ fetch } = {}) {
  _fetch    = fetch;
  _inFlight = null;
}

// One load serves every question. The two datasets have different lifetimes but always
// arrive together, so they share a single in-flight promise.
function _loadGuideData() {
  if (_inFlight) return _inFlight;
  if (!_fetch) return Promise.reject(new Error('guide source: initGuideSource was never called'));
  const p = _inFlight = Promise.all([
    _fetch(stampedUrl('js/finding-guides.json')).then(r => r.json()),
    _fetch(stampedUrl('js/sky-objects.json')).then(r => r.json()),
  ]).then(([guides, catalog]) => ({ guides, catalog }));
  // A failure is not an answer. find-guide.js only ever assigned _guidesCache on success,
  // so a guide tapped after a dropped connection tried again; holding on to the rejected
  // promise would make the first failure permanent for the rest of the session.
  //
  // Guarded on identity: this module advertises that initGuideSource can be called again,
  // so a slow FIRST load can still be in the air when a SECOND one starts. Clearing
  // _inFlight unconditionally would then throw away the newer load's cache when the older
  // one finally rejects, and the next question would re-fetch both files for nothing.
  return p.catch(e => { if (_inFlight === p) _inFlight = null; throw e; });
}

// Pull the data down ahead of the first question, so the first tap is instant.
// find-guide.js did this at script load; with fetch injected there is nothing to fetch
// with until a host has called initGuideSource, so warming is now something a host asks
// for. Failure is not this caller's problem — whoever asks a real question will see it.
function warmGuideSource() {
  return _loadGuideData().catch(() => {});
}

// The sky catalog finding-guide steps resolve their ids against. A separate accessor
// rather than a field on a prepared guide: two datasets with two lifetimes that happen
// to load together, and welding them into one value would say they are one thing.
function skyCatalog() {
  return _loadGuideData().then(d => d.catalog);
}

// Is there a guide for this constellation? Two callers only ever ask this — the "? Help"
// button and the info modal's "Finding guide" link — and both used to re-derive it as
// `guides[con.name]?.steps?.length`, one of them by reaching across files into
// find-guide.js's underscore-private _loadGuides.
function hasGuide(con) {
  return _loadGuideData().then(d => !!_guideFor(d.guides, con));
}

// The one place that knows guides are keyed by DISPLAY NAME. No caller learns it, which
// is what would make re-keying the JSON by abbr a one-line change here and nowhere else.
// A guide with no steps is not a guide, which is how the data spells "not written yet".
function _guideFor(guides, con) {
  const g = guides[con.name];
  return g && g.steps && g.steps.length ? g : null;
}

// A guide ready to hand to guideStart. Resolves null when there is no guide for this
// constellation; REJECTS when the load failed — find-help.html already writes two
// different messages for those two cases.
// `origin` is REQUIRED. Every guide's opener is a `random` step, which carries no
// coordinates of its own because it is told where to point here. Omitting the origin
// therefore does not degrade gracefully — it yields an opener with no ra/dec, and
// raDecToVec(undefined, undefined) aims the camera at NaN: a blank sky, silently. The
// schema gate cannot catch it either, since it exempts random steps from carrying
// coordinates by design.
//
// It THROWS rather than rejecting. A rejection from here means "the load failed", which
// find-help.html renders as "Could not load finding guide."; calling the function wrong
// is not a network problem and must not be reported to a learner as one. Same reasoning
// as guideStart's roll (#88).
function prepareGuide(con, { origin } = {}) {
  if (!origin || typeof origin.ra !== 'number' || typeof origin.dec !== 'number') {
    throw new Error('prepareGuide: origin { ra, dec } is required — every guide opens on ' +
                    'a random step that has no coordinates of its own');
  }
  return _loadGuideData().then(d => {
    const guide = _guideFor(d.guides, con);
    if (!guide) return null;
    const steps = _prepareSteps(guide, origin);
    return { steps, roll: _guideRoll(guide, con), problems: _guideProblems(guide) };
  });
}

// Copy first, then fill. The copy is defensive and load-bearing: the guide data is cached
// and shared by every caller, so preparing a guide must not write through to it.
//
// `origin` answers "where is the learner looking?" — a question only the host can answer.
// In-app that is the current view, so a guide opens where the learner already is;
// standalone there is no prior view, so find-help.html passes a random sky point. Every
// guide carries exactly one `random` step, its opener.
function _prepareSteps(guide, origin) {
  const steps = guide.steps.map(s => Object.assign({}, s));
  if (origin) {
    steps.forEach(s => { if (s.random) { s.ra = origin.ra; s.dec = origin.dec; } });
  }
  return steps;
}

// The guide's default roll: north-up at the constellation, plus the guide's own rotation
// where it sets one (2 of the 88 do). guideStart is TOLD this (#88) rather than reading
// explore.R at call time — the ordering contract that made both hosts assign explore.R
// immediately before calling it, and that 270 of the 338 steps depend on.
function _guideRoll(guide, con) {
  const northUp = guideNorthUpR(raDecToVec(con.ra, con.dec));
  return guide.rotation != null ? northUp + guide.rotation : northUp;
}

// ── The schema gate ──────────────────────────────────────────────────────────
// A step declares two independent things: WHERE TO POINT and WHAT TO SHOW (CONTEXT.md).
// makeStepDisplay has gated the second half since #38. This gates the first, in the same
// idiom and reporting into the same kind of `problems` list, so the data has one sort of
// complaint rather than two.

// Where to point, and what to say. This module's half.
const GS_CAMERA_FIELDS = ['ra', 'dec', 'fov', 'rotation', 'random'];
const GS_COPY_FIELDS   = ['title', 'caption'];
// What to show. step-display.js's half — known here only so this gate stays quiet about
// fields that are somebody else's business. A step carrying `highlight` is not malformed.
//
// The layer names are READ FROM _SD_LAYERS rather than retyped. A hand-copied list is a
// validator that will eventually lie about the module it defers to: add a sixth layer
// there, use it in a step, and this gate would report "key nothing reads" for data that
// is perfectly valid. The rest are step-display's non-layer fields, which have no list
// of their own to borrow.
// _SD_LAYERS is referenced directly, with no typeof guard: a guard would fall back to an
// empty list and quietly report every layer field as unknown, which is a worse lie than
// the drift it was guarding against. Both pages load step-display.js before this file, so
// a missing _SD_LAYERS is a load-order bug and deserves to say so by name.
const GS_DISPLAY_EXTRAS = ['lines', 'lineColor', 'lineWidth', 'highlight', 'precessionCircle'];
function _gsKnownFields() {
  return GS_CAMERA_FIELDS.concat(GS_COPY_FIELDS, _SD_LAYERS, GS_DISPLAY_EXTRAS);
}

// Guide-level keys. The real data has exactly two, and a typo in one of them is worse
// than a typo in a step: `rotaion: 0.31` is silently ignored and the whole guide flies at
// the wrong roll, every step of it.
const GS_GUIDE_FIELDS = ['rotation', 'steps'];

function _guideProblems(guide) {
  const problems = [];
  const known = _gsKnownFields();
  for (const k of Object.keys(guide)) {
    if (!GS_GUIDE_FIELDS.includes(k)) problems.push(`guide key nothing reads: ${k}`);
  }
  if (guide.rotation != null && typeof guide.rotation !== 'number') {
    problems.push(`guide rotation is not a number: ${guide.rotation}`);
  }
  // A stub is the corruption this gate is least able to see from the outside: _guideFor
  // reads "no steps" as "no guide", so a guide someone meant to write and left empty just
  // vanishes from the UI with nothing said anywhere. Reported here, where the raw entry is
  // in hand. Also stops the walk below throwing on an entry with no steps key at all.
  if (!Array.isArray(guide.steps) || !guide.steps.length) {
    problems.push('guide has no steps — it will silently not exist');
    return problems;
  }
  guide.steps.forEach((step, i) => {
    for (const k of Object.keys(step)) {
      if (!known.includes(k)) problems.push(`#${i}: key nothing reads: ${k}`);
    }
    // A `random` step is told where to point at prepare time, so it is the one step that
    // legitimately arrives without coordinates. Every other step must carry its own.
    if (!step.random) {
      for (const k of ['ra', 'dec', 'fov']) {
        if (typeof step[k] !== 'number') problems.push(`#${i}: missing or non-numeric ${k}`);
      }
    } else if (typeof step.fov !== 'number') {
      problems.push(`#${i}: random step still needs its own fov`);
    }
    if (step.rotation != null && typeof step.rotation !== 'number') {
      problems.push(`#${i}: rotation is not a number: ${step.rotation}`);
    }
    for (const k of GS_COPY_FIELDS) {
      if (typeof step[k] !== 'string' || !step[k].trim()) problems.push(`#${i}: empty ${k}`);
    }
  });
  return problems;
}
