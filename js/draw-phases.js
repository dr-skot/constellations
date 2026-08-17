// ═══════════════════════════════════════════════════════════
// PER-PHASE DRAW TIMING (issue #52)
// ═══════════════════════════════════════════════════════════
// Where does a frame of drawExplore actually go? Reading the code ranks the layer
// passes by guesswork; this measures them. The answer decides whether the next round
// of work targets stars, boundary lines, or label placement — a multi-day port either
// way, so it is worth an evening of measuring first.
//
// Two halves, deliberately separate:
//
//   The HOOK (beginDrawPhases / markDrawPhase / endDrawPhases) is what drawExplore
//   calls. With no sink installed it is three empty calls per frame plus one per layer
//   boundary — against the ~1,262 points a wide-field frame projects, not measurable.
//   A normal run therefore pays nothing for instrumentation it never reads.
//
//   The COLLECTOR (makePhaseCollector) is a pure accumulator with its clock injected,
//   so test/draw-phases.js exercises it with no browser, no canvas and no real time.
//   The perf probe installs one as the sink; nothing else knows it exists.
//
// KNOWN BLIND SPOT: this measures main-thread CPU time. gl.drawElements returns long
// before the GPU has done the work, so the photo and art phases read near zero even
// when fill rate is a genuine cost. That is acceptable because every suspect here is a
// 2D canvas pass — but it makes one outcome specifically informative: all phases small
// with a bad frame total means the problem is GPU or input rate, not any layer.

// ── The hook ───────────────────────────────────────────────
// A single mutable reference rather than a list of listeners: there is exactly one
// probe, and a null check is the cheapest possible off-switch.
let _drawPhaseSink = null;

function setDrawPhaseSink(sink) { _drawPhaseSink = sink || null; }

// `meta` describes the frame being drawn (field of view, visible-constellation count)
// so a reading can be compared against another taken at a different zoom. Without it
// two runs of numbers are not comparable and the measurement is worthless.
function beginDrawPhases(meta) { if (_drawPhaseSink) _drawPhaseSink.begin(meta); }

// Marks the START of `name`; it runs until the next mark or the end of the frame.
// Naming the boundary that opens a phase (rather than the one that closes it) is what
// lets the call sites sit exactly on drawExplore's existing section comments.
function markDrawPhase(name) { if (_drawPhaseSink) _drawPhaseSink.mark(name); }

function endDrawPhases() { if (_drawPhaseSink) _drawPhaseSink.end(); }

// ── The collector ──────────────────────────────────────────
// opts.now     () -> ms, injected so the tests can drive time by hand
// opts.frames  how many recent frames to average over (default 60, about a second)
function makePhaseCollector(opts) {
  const now = (opts && opts.now) || (() => performance.now());
  const limit = (opts && opts.frames) || 60;

  const recent = [];       // [{ total, phases: { name: ms } }], newest last
  let meta = {};
  let open = null;         // the frame in flight, or null between frames

  // Time before the first mark of a frame belongs to no phase — drawExplore sizes the
  // canvas and builds the Camera before its first section. That gap is deliberately
  // left unattributed so it shows up as frame total exceeding the sum of the phases,
  // rather than being quietly folded into whichever phase happens to be marked first.
  function closeCurrent(t) {
    if (open && open.current !== null) {
      open.phases[open.current] = (open.phases[open.current] || 0) + (t - open.currentAt);
    }
  }

  function begin(m) {
    if (m) meta = m;
    open = { t0: now(), phases: {}, current: null, currentAt: 0 };
  }

  // A mark outside a frame is dropped rather than opening one. The probe installs and
  // removes the sink at runtime, so a stray mark is a legitimate race, not a bug — but
  // inventing a frame from it would corrupt the averages with a frame that never ran.
  function mark(name) {
    if (!open) return;
    const t = now();
    closeCurrent(t);
    open.current = name;
    open.currentAt = t;
  }

  function end() {
    if (!open) return;
    const t = now();
    closeCurrent(t);
    recent.push({ total: t - open.t0, phases: open.phases });
    while (recent.length > limit) recent.shift();
    open = null;
  }

  // Means are per FRAME, not per appearance: a phase absent from a frame contributes
  // zero to its own mean. That is the number that ranks the layers by what they cost
  // to keep switched on — a pass that only runs occasionally genuinely is cheap on
  // average, and `max` is there to catch the spike it makes when it does run.
  function stats() {
    const n = recent.length;
    const acc = {};
    let totalSum = 0, totalMax = 0;
    for (const f of recent) {
      totalSum += f.total;
      if (f.total > totalMax) totalMax = f.total;
      for (const k in f.phases) {
        if (!acc[k]) acc[k] = { sum: 0, max: 0 };
        acc[k].sum += f.phases[k];
        if (f.phases[k] > acc[k].max) acc[k].max = f.phases[k];
      }
    }
    // Ranked most expensive first: the readout is a handful of lines on a phone, and
    // the ordering is what makes it legible without scrolling. Sorting here rather
    // than in the probe keeps that decision in the tested half.
    const phases = Object.keys(acc)
      .map(k => ({ name: k, mean: n ? acc[k].sum / n : 0, max: acc[k].max }))
      .sort((a, b) => b.mean - a.mean);
    return {
      frames: n,
      phases,
      frame: { mean: n ? totalSum / n : 0, max: totalMax },
      meta,
    };
  }

  function reset() {
    recent.length = 0;
    open = null;
    meta = {};
  }

  return { begin, mark, end, stats, reset };
}
