// js/step-display.js
// The step display — what a finding-guide step asks the explorer to show.
//
// A guide step declares two independent things: where to point (ra/dec/fov/rotation,
// TWEENED between steps by the camera animation) and what to show (LAYERS, guide LINES
// and highlight MARKS, INTERSECTED between steps so only what both have in common stays
// lit during the flight). This module owns the second. That difference in transition
// discipline is why the seam sits here. See CONTEXT.md and spec #37.
//
// Pure: no document, no window, no globals. Loadable in node, which is the point —
// guide-renderer.js registers a window listener at load and so has never been testable.

const _SD_LAYERS = ['photo', 'diagram', 'bounds', 'art', 'names'];

// A layer is declared as absent | boolean | array-of-abbrs. The array means "on, but
// only for these constellations". Decoded exactly once, here; the pre-refactor code
// decoded it twice — as a boolean in resolveDisplayFlags and as an allowlist in
// drawExplore, 460 lines apart.
function _sdLayer(raw) {
  const written = raw || false;
  return { on: !!written, only: Array.isArray(written) ? written : null };
}

const SD_LINE_COLOR = 'rgba(140,200,255,0.9)';
const SD_LINE_WIDTH = 5;              // base; the renderer still scales by field of view

// Star-to-star guide lines, drawn on the sky canvas. Endpoints resolve here rather than
// per frame, so the catalog stops riding on the explore bus and an unresolvable name
// becomes reportable instead of a silent skip.
function _sdLines(step, catalog, problems) {
  if (!step.lines?.length) return null;
  const segments = [];
  for (const [nameA, nameB] of step.lines) {
    const a = catalog && catalog[nameA];
    const b = catalog && catalog[nameB];
    if (!a) problems.push(`line endpoint not in catalog: ${nameA}`);
    if (!b) problems.push(`line endpoint not in catalog: ${nameB}`);
    if (!a || !b) continue;
    segments.push({
      names: [nameA, nameB],           // identity: intersectDisplays matches on this
      a: { ra: a.ra, dec: a.dec },
      b: { ra: b.ra, dec: b.dec },
    });
  }
  if (!segments.length) return null;
  return {
    segments,
    color: step.lineColor || SD_LINE_COLOR,
    width: step.lineWidth || SD_LINE_WIDTH,
  };
}

// Resolve one highlight entry against the catalog. Transcribed from the pre-refactor
// guideResolveHighlight: the string shorthand becomes {id}, the catalog object is merged
// under a label defaulting to the id, and the raw entry overrides both.
function _sdResolve(raw, catalog, problems) {
  const h = (typeof raw === 'string') ? { id: raw } : raw;
  if (!h.id) return h;                 // an entry carrying its own coordinates
  const obj = catalog && catalog[h.id];
  if (!obj) { problems.push(`highlight not in catalog: ${h.id}`); return null; }
  return Object.assign({}, obj, { label: h.label != null ? h.label : h.id }, h);
}

// Highlights, normalized into kind-tagged marks. The kind tag is what lets the painter
// switch once instead of probing raw fields, and what makes hasOverlays a query rather
// than a hand-written list of field names.
const SD_CAPSULE_COLOR = '#fff';

// The keys the painter actually reads. Anything else in the data is a field nobody
// consumes — invisible in the browser, reportable here.
const _SD_HIGHLIGHT_KEYS = ['id', 'label', 'capsule', 'color', 'crosshair', 'line', 'margin'];
const _SD_CAPSULE_KEYS   = ['id', 'label'];

function _sdUnknownKeys(obj, known, where, problems) {
  if (!obj || typeof obj !== 'object') return;
  for (const k of Object.keys(obj)) {
    if (!known.includes(k)) problems.push(`${where}: key nothing reads: ${k}`);
  }
}

// A capsule resolves its own elements. Kept faithful to the pre-refactor painter: no
// label defaulting to the id here (unlike every other kind), and an element carrying its
// own coordinates is used as-is. The painter's second cull — points facing away from the
// camera — stays at draw time, so it keeps its own fewer-than-two check.
function _sdCapsule(raw, catalog, problems) {
  const points = [];
  for (let e of raw.capsule) {
    if (typeof e === 'string') e = { id: e };
    else _sdUnknownKeys(e, _SD_CAPSULE_KEYS, 'capsule element', problems);
    const obj = e.id ? (catalog && catalog[e.id]) : e;
    if (!obj) { problems.push(`capsule element not in catalog: ${e.id}`); continue; }
    points.push({ ra: obj.ra, dec: obj.dec, arcmin: obj.arcmin, label: e.label });
  }
  if (points.length < 2) return null;
  return {
    kind: 'capsule',
    points,
    color: raw.color || SD_CAPSULE_COLOR,
    label: raw.label,
    margin: raw.margin,                // absent means the painter's own pixel default
  };
}

function _sdMarks(step, catalog, problems) {
  const marks = [];
  // Drawn before the highlight loop, so it leads the list. Making it a mark is what lets
  // hasOverlays be a query — the pre-refactor field list omitted it.
  if (step.precessionCircle) {
    marks.push({ kind: 'precession', south: step.precessionCircle === 'south' });
  }
  for (const raw of step.highlight || []) {
    if (typeof raw !== 'string') _sdUnknownKeys(raw, _SD_HIGHLIGHT_KEYS, 'highlight', problems);
    let mark = null;
    if (raw && raw.capsule) {          // checked before resolution, as the painter does
      mark = _sdCapsule(raw, catalog, problems);
    } else {
      const h = _sdResolve(raw, catalog, problems);
      if (h && h.line) {
        mark = { kind: 'line', points: h.line.map(([ra, dec]) => ({ ra, dec })), color: h.color, label: h.label };
      } else if (h && h.crosshair) {
        // color is carried but the painter hardcodes its own — preserved so a validator
        // can see a field the data sets and nothing reads.
        mark = { kind: 'crosshair', ra: h.ra, dec: h.dec, color: h.color, label: h.label };
      } else if (h) {
        mark = { kind: 'circle', ra: h.ra, dec: h.dec, arcmin: h.arcmin, color: h.color, label: h.label };
      }
    }
    if (mark) marks.push(Object.assign(mark, { key: _sdMarkKey(raw) }));
  }
  return marks;
}

// Identity for the transition intersection, transcribed from _guideIntersectAnnotation:
// the catalog id when there is one, otherwise the entry serialized. Note this means a
// bare "Rigel" and { id: 'Rigel' } are different identities, and two identical anonymous
// capsules share one — both true before this change, both preserved.
function _sdMarkKey(raw) {
  return (raw && raw.id) || JSON.stringify(raw);
}

// step → StepDisplay. The ONLY conversion out of raw guide JSON; intersectDisplays and
// displayWithoutOverlays work in the normalized domain.
function makeStepDisplay(step, catalog) {
  const problems = [];
  const layers = {};
  for (const name of _SD_LAYERS) layers[name] = _sdLayer(step[name]);
  const lines = _sdLines(step, catalog, problems);
  const marks = _sdMarks(step, catalog, problems);
  return { layers, lines, marks, problems };
}

// ── Overlays ──────────────────────────────────────────────────────────────────
// "Overlays" keeps the sense the learner already meets in the Show/Hide overlays
// button: everything the display turns on EXCEPT the photo. Asking the value means a
// new kind cannot be forgotten — the pre-refactor version was a hand-written list of
// field names, and it had already lost the precession circle.

function hasOverlays(display) {
  const layersOn = _SD_LAYERS.some(name => name !== 'photo' && display.layers[name].on);
  return layersOn || !!display.lines || display.marks.length > 0;
}

// What the Hide overlays button produces: the bare photo. Returns a new display rather
// than editing the one it was given, so the full display survives to be restored.
function displayWithoutOverlays(display) {
  const layers = {};
  for (const name of _SD_LAYERS) {
    layers[name] = name === 'photo'
      ? { on: display.layers.photo.on, only: display.layers.photo.only }
      : { on: false, only: null };
  }
  return { layers, lines: null, marks: [], problems: [] };
}

// ── The transition ────────────────────────────────────────────────────────────
// What stays lit while the camera flies from one step to the next: only what both
// steps have in common. Departing elements clear before the flight and arriving ones
// appear on landing, so nothing pops in mid-motion.

// Transcribed from _intersectFilter. Two filtered layers meet at the constellations
// they share; otherwise the pre-refactor `a && b` yields b whenever a is on, which is
// why an unfiltered destination layer clears the origin's filter.
function _sdIntersectLayer(a, b) {
  if (a.only && b.only) {
    const shared = b.only.filter(x => a.only.includes(x));
    return { on: shared.length > 0, only: shared.length ? shared : null };
  }
  return a.on ? { on: b.on, only: b.only } : { on: false, only: null };
}

function _sdIntersectLines(a, b) {
  if (!a.lines || !b.lines) return null;
  const seen = new Set(a.lines.segments.map(s => s.names.join('|')));
  const segments = b.lines.segments.filter(s => seen.has(s.names.join('|')));
  if (!segments.length) return null;
  return { segments, color: b.lines.color, width: b.lines.width };
}

function intersectDisplays(a, b) {
  const layers = {};
  for (const name of _SD_LAYERS) layers[name] = _sdIntersectLayer(a.layers[name], b.layers[name]);
  const seen = new Set(a.marks.map(m => m.key));
  return {
    layers,
    lines: _sdIntersectLines(a, b),
    // Keyed marks only: the precession circle has no key and so never survives a
    // flight, matching the pre-refactor intersection, which carried highlights alone.
    marks: b.marks.filter(m => m.key !== undefined && seen.has(m.key)),
    problems: [],
  };
}
