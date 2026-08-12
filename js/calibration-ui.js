// ═══════════════════════════════════════════════════════════
// CALIBRATION SCREEN — the level-check flow (issue #33)
// ═══════════════════════════════════════════════════════════
//
// Offer → 8 shuffled probes → payoff, on the dedicated #screen-calibration.
// The pure pieces live in js/calibration.js (calibrationProbes, pickDistractors,
// dStarFromProbeResults, seedExposureFromCalibration); this is the impure DOM
// adapter, mirroring the course.js / quiz.js screen wiring. Reached for now via a
// manual trigger on the course screen — the real entry points are ticket #34.

let calState = { probes: [], idx: 0, results: [] };

function showCalPanel(name) {
  document.querySelectorAll('#screen-calibration .cal-panel')
    .forEach(p => p.classList.remove('active'));
  document.getElementById('cal-' + name).classList.add('active');
}

// Entry point (routed from #calibration): reset and show the offer.
function startCalibration() {
  calState = { probes: [], idx: 0, results: [] };
  showScreen('calibration');
  showCalPanel('offer');
}

// Offer → begin the 8 shuffled probes.
function calBegin() {
  // Shuffle presentation order (D* is scored by band, so this never affects the result).
  calState.probes = shuffleInPlace(calibrationProbes(C));
  calState.idx = 0;
  calState.results = [];
  showCalPanel('probes');
  renderCalProbe();
}

function renderCalProbe() {
  const con = calState.probes[calState.idx];

  // Progress pips + count.
  const pips = document.getElementById('cal-pips');
  pips.innerHTML = '';
  for (let i = 0; i < calState.probes.length; i++) {
    const d = document.createElement('div');
    d.className = 'cal-pip' + (i < calState.idx ? ' done' : i === calState.idx ? ' cur' : '');
    pips.appendChild(d);
  }
  document.getElementById('cal-count').textContent =
    `${calState.idx + 1} / ${calState.probes.length}`;

  // Figure — the real TAN stick-figure (conGlyph), tuned brighter/larger for a hero.
  const figHost = document.getElementById('cal-fig');
  figHost.innerHTML = '';
  const size = figHost.clientWidth || 320;
  figHost.appendChild(conGlyph(con, size, {
    starBase: 4.7, starSlope: 0.62, starMin: 1.1, lineWidth: 1.3,
    lineColor: 'rgba(180,195,230,.55)', glow: true,
  }));

  // Four choices: the answer + three distinct catalog distractors, shuffled.
  const choices = shuffleInPlace([con.name, ...pickDistractors(con, C, Math.random, 3)]);
  const box = document.getElementById('cal-choices');
  box.innerHTML = '';
  for (const name of choices) {
    const b = document.createElement('button');
    b.className = 'cal-choice';
    b.textContent = name;
    b.addEventListener('click', () => calAnswer(name, b));
    box.appendChild(b);
  }
  document.getElementById('cal-nextbar').innerHTML = '';
}

function calAnswer(name, btn) {
  const con = calState.probes[calState.idx];
  const correct = name === con.name;
  calState.results[calState.idx] = { diff: con.diff, correct };

  // Lock the choices; mark the right answer green and a wrong pick red.
  document.querySelectorAll('#cal-choices .cal-choice').forEach(c => {
    c.disabled = true;
    if (c.textContent === con.name) c.classList.add('correct');
    else if (c === btn) c.classList.add('wrong');
  });

  // Feedback + advance.
  const last = calState.idx === calState.probes.length - 1;
  const bar = document.getElementById('cal-nextbar');
  bar.innerHTML =
    `<span class="cal-verdict ${correct ? 'ok' : 'no'}">` +
    `${correct ? 'Correct' : 'That was ' + con.name}</span>`;
  const next = document.createElement('button');
  next.className = 'cal-btn-next';
  next.textContent = last ? 'See my results' : 'Next';
  next.addEventListener('click', () => {
    if (last) { calFinish(dStarFromProbeResults(calState.results)); }
    else { calState.idx++; renderCalProbe(); }
  });
  bar.appendChild(next);
}

// Skip → D* = 0 (no seeding, no-op) and straight to the payoff's "from the beginning".
function calSkip() { calFinish(0); }

// Score → seed → payoff. Snapshots exposure before seeding so newlyPassed() can
// light exactly the constellations this run unlocked on the payoff grid.
function calFinish(dStar) {
  const before = loadExposure();
  seedExposureFromCalibration(dStar);   // no-op when dStar <= 0
  const after = loadExposure();
  showCalPayoff(dStar, before, after);
}

function showCalPayoff(dStar, before, after) {
  // Count derives from the same targets the seed wrote, so the two never drift.
  const unlocked = calibrationSeedTargets(C, dStar).length;

  const head = document.getElementById('cal-res-head');
  const unlock = document.getElementById('cal-res-unlock');
  const band = document.getElementById('cal-res-band');
  if (dStar <= 0) {
    head.textContent = 'Starting from the beginning';
    unlock.innerHTML = 'No worries — we’ll introduce constellations one at a time, from the easiest.';
    band.textContent = '';
  } else if (dStar >= 8) {
    head.textContent = 'You know the whole sky';
    unlock.innerHTML = `All <b>${unlocked}</b> constellations unlocked for review — you’ll skip every introduction and go straight to practice.`;
    band.textContent = `difficulty band ${dStar} of 8`;
  } else {
    head.textContent = 'We’ve placed you';
    unlock.innerHTML = `<b>${unlocked}</b> constellations unlocked for review — you’re skipping the intro grind and starting where you already are.`;
    band.textContent = `difficulty band ${dStar} of 8`;
  }

  // The real progress grid (shared renderer), lighting the just-seeded cons via the
  // newlyPassed highlight. Reads the freshly-seeded exposure, so cells light for free.
  renderProgressGrid(document.getElementById('cal-grid'), C, after, {
    highlight: newlyPassed(before, after, C),
    onCardClick: (con, card) => showCourseDetail(con, card),
  });

  showCalPanel('payoff');
}

// Wire the buttons + manual trigger once, from main.js init.
function initCalibration() {
  document.getElementById('cal-begin').addEventListener('click', calBegin);
  document.getElementById('cal-skip').addEventListener('click', calSkip);
  document.getElementById('cal-start-lesson').addEventListener('click', () => {
    // Drop any stale in-flight lesson so this generates a fresh one on the seeded
    // exposure (navigate('lesson') would otherwise resume a leftover session).
    sessionStorage.removeItem('lesson-session');
    navigate('lesson');
  });
  document.getElementById('cal-retake').addEventListener('click', startCalibration);
  // Temporary entry (ticket #34 finalizes the first-run offer + course-screen re-run).
  const trigger = document.getElementById('btn-level-check');
  if (trigger) trigger.addEventListener('click', () => navigate('calibration'));
}
