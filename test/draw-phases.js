#!/usr/bin/env node
// Unit test for makePhaseCollector (js/draw-phases.js) — the pure accumulator behind
// the per-phase draw probe (issue #52). It turns a stream of phase marks into
// per-phase mean/max over a rolling window of frames, so a drag on the device can say
// where a frame's time actually went.
//
// The clock is injected, so this runs with no browser, no canvas and no real time.
// Only external behaviour is asserted: marks in, statistics out. How the collector
// stores its window is its own business.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const jsDir = path.join(__dirname, '..', 'js');
vm.runInThisContext(fs.readFileSync(path.join(jsDir, 'draw-phases.js'), 'utf8'),
  { filename: 'draw-phases.js' });

const failures = [];
const check = (name, ok, detail) => ok ? console.log(`OK: ${name}`)
  : (failures.push(name), console.log(`FAIL: ${name}` + (detail ? ` — ${detail}` : '')));

// A clock the test drives by hand. `at(t)` sets the reading the collector will see.
function fakeClock() {
  let t = 0;
  const now = () => t;
  now.at = v => { t = v; };
  return now;
}

// Pull one phase out of stats() by name. Returns null when the phase is absent
// entirely, which is different from a phase present with a mean of zero.
const phase = (s, name) => s.phases.find(p => p.name === name) || null;

// ── 1. One frame: each phase runs until the next mark ──────────────────────────
{
  const now = fakeClock();
  const c = makePhaseCollector({ now });
  now.at(0);  c.begin();
  now.at(0);  c.mark('setup');
  now.at(5);  c.mark('bounds');
  now.at(12); c.mark('stars');
  now.at(30); c.end();
  const s = c.stats();
  check('one frame: setup spans to the next mark', phase(s, 'setup').mean === 5,
    `got ${JSON.stringify(phase(s, 'setup'))}`);
  check('one frame: bounds spans to the next mark', phase(s, 'bounds').mean === 7);
  check('one frame: the last phase spans to end()', phase(s, 'stars').mean === 18);
  check('one frame: frame total is begin to end', s.frame.mean === 30, `got ${s.frame.mean}`);
  check('one frame: frame count is 1', s.frames === 1);
}

// ── 2. Time before the first mark is unattributed, not silently folded in ──────
// drawExplore does real work (canvas sizing, camera build) before its first mark.
// That gap must show up as frame total exceeding the sum of the phases, so it can
// never masquerade as a cheap frame.
{
  const now = fakeClock();
  const c = makePhaseCollector({ now });
  now.at(0);  c.begin();
  now.at(4);  c.mark('stars');   // 4ms before the first mark
  now.at(10); c.end();
  const s = c.stats();
  check('pre-first-mark time is not attributed to a phase', phase(s, 'stars').mean === 6);
  check('pre-first-mark time still counts in the frame total', s.frame.mean === 10);
}

// ── 3. A phase marked twice in one frame sums ─────────────────────────────────
{
  const now = fakeClock();
  const c = makePhaseCollector({ now });
  now.at(0);  c.begin();
  now.at(0);  c.mark('stars');
  now.at(3);  c.mark('lines');
  now.at(5);  c.mark('stars');   // second pass over stars
  now.at(9);  c.end();
  const s = c.stats();
  check('a phase marked twice in a frame sums its spans', phase(s, 'stars').mean === 7,
    `got ${JSON.stringify(phase(s, 'stars'))}`);
  check('the other phase is unaffected', phase(s, 'lines').mean === 2);
}

// ── 4. Mean and max across several frames ─────────────────────────────────────
{
  const now = fakeClock();
  const c = makePhaseCollector({ now });
  // Three frames where `stars` costs 10, 20, 30.
  let t = 0;
  for (const cost of [10, 20, 30]) {
    now.at(t); c.begin();
    now.at(t); c.mark('stars');
    t += cost;
    now.at(t); c.end();
    t += 100;  // idle between frames — must not count toward anything
  }
  const s = c.stats();
  check('mean across frames', phase(s, 'stars').mean === 20, `got ${phase(s, 'stars').mean}`);
  check('max across frames', phase(s, 'stars').max === 30);
  check('idle time between frames is excluded', s.frame.mean === 20, `got ${s.frame.mean}`);
  check('frame count across frames', s.frames === 3);
}

// ── 5. A phase absent from a frame counts as zero toward its mean ─────────────
// A layer that is toggled off costs nothing, and its mean should say so — the
// statistic wanted is average cost per frame, which is what ranks the layers.
{
  const now = fakeClock();
  const c = makePhaseCollector({ now });
  now.at(0);  c.begin(); now.at(0); c.mark('bounds'); now.at(10); c.end();
  now.at(20); c.begin(); now.at(20); c.mark('stars');  now.at(30); c.end();
  const s = c.stats();
  check('absent-from-a-frame averages over all frames', phase(s, 'bounds').mean === 5,
    `got ${phase(s, 'bounds').mean}`);
  check('max still reports the frame it did appear in', phase(s, 'bounds').max === 10);
}

// ── 6. The window drops the oldest frames ─────────────────────────────────────
{
  const now = fakeClock();
  const c = makePhaseCollector({ now, frames: 3 });
  let t = 0;
  for (const cost of [100, 1, 2, 3]) {   // the 100ms frame should fall out of a 3-frame window
    now.at(t); c.begin(); now.at(t); c.mark('stars');
    t += cost;
    now.at(t); c.end();
  }
  const s = c.stats();
  check('window keeps only the most recent frames', s.frames === 3, `got ${s.frames}`);
  check('an evicted frame no longer affects max', phase(s, 'stars').max === 3,
    `got ${phase(s, 'stars').max}`);
  check('an evicted frame no longer affects mean', phase(s, 'stars').mean === 2);
}

// ── 7. Phases are ranked most expensive first ─────────────────────────────────
// The readout is a few lines on a phone; the ordering is what makes it readable
// without scrolling, so it belongs in the collector rather than in each caller.
{
  const now = fakeClock();
  const c = makePhaseCollector({ now });
  now.at(0);  c.begin();
  now.at(0);  c.mark('cheap');
  now.at(1);  c.mark('dear');
  now.at(21); c.mark('middling');
  now.at(26); c.end();
  const s = c.stats();
  check('phases are sorted by mean, descending',
    s.phases.map(p => p.name).join(',') === 'dear,middling,cheap',
    `got ${s.phases.map(p => p.name).join(',')}`);
}

// ── 8. Meta from the most recent frame is carried through ─────────────────────
// The readout needs the field of view and visible-constellation count that produced
// the numbers, or the numbers cannot be compared between runs.
{
  const now = fakeClock();
  const c = makePhaseCollector({ now });
  now.at(0); c.begin({ fov: 110, visible: 31 }); now.at(0); c.mark('stars'); now.at(5); c.end();
  now.at(9); c.begin({ fov: 40, visible: 9 });   now.at(9); c.mark('stars'); now.at(14); c.end();
  check('meta reports the most recent frame', c.stats().meta.fov === 40);
  check('meta carries every field given', c.stats().meta.visible === 9);
}

// ── 9. Misuse is inert, never a crash ─────────────────────────────────────────
// The hook is installed and removed at runtime by the perf probe, so a mark can
// legitimately arrive with no frame open. Dropping it must not throw and must not
// invent a frame.
{
  const now = fakeClock();
  const c = makePhaseCollector({ now });
  let threw = null;
  try {
    now.at(0); c.mark('orphan');       // no begin
    now.at(1); c.end();                // no begin
    c.stats();
  } catch (e) { threw = e; }
  check('marks outside a frame do not throw', threw === null, threw && threw.message);
  check('marks outside a frame record no frame', c.stats().frames === 0);
  check('marks outside a frame record no phase', c.stats().phases.length === 0);
}

// ── 10. Empty stats are safe to render ────────────────────────────────────────
{
  const c = makePhaseCollector({ now: fakeClock() });
  const s = c.stats();
  check('empty: no frames', s.frames === 0);
  check('empty: no phases', Array.isArray(s.phases) && s.phases.length === 0);
  check('empty: frame stats are zero, not NaN', s.frame.mean === 0 && s.frame.max === 0);
  check('empty: meta is an object', s.meta && typeof s.meta === 'object');
}

// ── 11. reset() clears the window ─────────────────────────────────────────────
{
  const now = fakeClock();
  const c = makePhaseCollector({ now });
  now.at(0); c.begin(); now.at(0); c.mark('stars'); now.at(10); c.end();
  c.reset();
  const s = c.stats();
  check('reset clears frames', s.frames === 0);
  check('reset clears phases', s.phases.length === 0);
}

// ── 12. The sink hook is inert until a collector is installed ─────────────────
// This is what keeps a normal run from paying for instrumentation it is not using.
{
  let threw = null;
  try {
    beginDrawPhases({ fov: 60 });
    markDrawPhase('stars');
    endDrawPhases();
  } catch (e) { threw = e; }
  check('hook with no sink does nothing and does not throw', threw === null, threw && threw.message);

  const now = fakeClock();
  const c = makePhaseCollector({ now });
  setDrawPhaseSink(c);
  now.at(0); beginDrawPhases({ fov: 60 });
  now.at(0); markDrawPhase('stars');
  now.at(7); endDrawPhases();
  check('hook forwards to an installed sink', phase(c.stats(), 'stars').mean === 7);

  setDrawPhaseSink(null);
  now.at(10); beginDrawPhases(); now.at(10); markDrawPhase('stars'); now.at(99); endDrawPhases();
  check('removing the sink stops forwarding', c.stats().frames === 1,
    `got ${c.stats().frames}`);
}

console.log(failures.length ? `\n${failures.length} FAILED` : '\nall passed');
process.exit(failures.length ? 1 : 0);
