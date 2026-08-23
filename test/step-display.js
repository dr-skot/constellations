#!/usr/bin/env node
// Tests for js/step-display.js — the step display value (issue #38, spec #37).
//
// The oracle for layer normalization is a VERBATIM transcription of the
// pre-refactor pair: _guideApplySettings's write (guide-renderer.js) and
// drawExplore's Array.isArray decode (explore.js). Expected values come from
// that independent formula, not from the code under test.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const jsDir = path.join(__dirname, '..', 'js');
vm.runInThisContext(fs.readFileSync(path.join(jsDir, 'step-display.js'), 'utf8'), { filename: 'step-display.js' });

const failures = [];
const check = (name, ok, detail) => ok ? console.log(`OK: ${name}`)
  : (failures.push(name), console.log(`FAIL: ${name}` + (detail ? ` — ${detail}` : '')));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Marks carry a `key` for the transition intersection; shape assertions drop it and
// cycle 8 tests it directly.
const noKeys = (marks) => marks.map(m => { const { key, ...rest } = m; return rest; });

const CAT = {
  Betelgeuse: { ra: 88.79, dec: 7.41, color: '#ffa04d' },
  Rigel:      { ra: 78.63, dec: -8.20, color: '#9bb0ff' },
  Mintaka:    { ra: 83.00, dec: -0.30, color: '#9bb0ff' },
  Alnitak:    { ra: 85.19, dec: -1.94, color: '#9bb0ff' },
  M42:        { ra: 83.82, dec: -5.39, color: '#ff9999', arcmin: 85 },
  Nocolor:    { ra: 10, dec: 20 },
};

// ---- Cycle 1: layer normalization -------------------------------------------
// ORACLE: exact transcription of the pre-refactor write + decode.
const oracleLayer = (stepValue) => {
  const written = stepValue || false;                                  // guide-renderer.js
  return { on: !!written, only: Array.isArray(written) ? written : null }; // explore.js
};

{
  const LAYERS = ['photo', 'diagram', 'bounds', 'art', 'names'];
  const VALUES = [undefined, true, false, ['Ori'], ['Ori', 'Tau']];
  let ok = true, detail = '';
  for (const layer of LAYERS) {
    for (const v of VALUES) {
      const step = {};
      if (v !== undefined) step[layer] = v;
      const got = makeStepDisplay(step, CAT).layers[layer];
      const want = oracleLayer(v);
      if (!eq(got, want)) { ok = false; detail = `${layer}=${JSON.stringify(v)}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`; }
    }
  }
  check('layers match the pre-refactor write+decode formula', ok, detail);
}

{
  const d = makeStepDisplay({ photo: true }, CAT);
  check('layers has exactly the five layer keys',
    eq(Object.keys(d.layers).sort(), ['art', 'bounds', 'diagram', 'names', 'photo']),
    Object.keys(d.layers).join(','));
}

{
  const d = makeStepDisplay({ equator: true }, CAT);
  check('no equator layer — a guide suppresses the reference guides as a rule',
    !('equator' in d.layers));
}

// ---- Cycle 2: guide lines ---------------------------------------------------
// ORACLE: the writer's defaults (guide-renderer.js) + the reader's catalog lookup and
// skip-unresolvable rule (explore.js).
{
  const d = makeStepDisplay({ lines: [['Mintaka', 'Alnitak']] }, CAT);
  check('lines resolve endpoints and keep the raw name pair', eq(d.lines.segments, [
    { names: ['Mintaka', 'Alnitak'],
      a: { ra: 83.00, dec: -0.30 },
      b: { ra: 85.19, dec: -1.94 } },
  ]), JSON.stringify(d.lines && d.lines.segments));
}

{
  const d = makeStepDisplay({ lines: [['Mintaka', 'Alnitak']] }, CAT);
  check('lines carry the writer\'s colour and width defaults',
    d.lines.color === 'rgba(140,200,255,0.9)' && d.lines.width === 5,
    `${d.lines.color} / ${d.lines.width}`);
}

{
  const d = makeStepDisplay({ lines: [['Mintaka', 'Alnitak']], lineColor: '#abc', lineWidth: 2 }, CAT);
  check('explicit colour and width win over the defaults',
    d.lines.color === '#abc' && d.lines.width === 2);
}

{
  check('no lines field yields null', makeStepDisplay({}, CAT).lines === null);
  check('empty lines array yields null', makeStepDisplay({ lines: [] }, CAT).lines === null);
}

{
  const d = makeStepDisplay({ lines: [['Mintaka', 'Nosuchstar'], ['Mintaka', 'Alnitak']] }, CAT);
  check('an unresolvable endpoint drops its segment and reports a problem',
    d.lines.segments.length === 1 && d.problems.length === 1 && /Nosuchstar/.test(d.problems[0]),
    `${d.lines.segments.length} segs, problems: ${JSON.stringify(d.problems)}`);
}

{
  const d = makeStepDisplay({ lines: [['Nosuchstar', 'Alsonosuch']] }, CAT);
  check('lines is null when every segment drops', d.lines === null,
    JSON.stringify(d.lines));
}

// ---- Cycle 3: circle marks --------------------------------------------------
// ORACLE: guideResolveHighlight (guide-renderer.js) — string shorthand becomes {id},
// the catalog object is merged under a label defaulting to the id, and the raw entry
// overrides both. An unresolvable id returns null and the painter skips it.
const oracleResolve = (h, catalog) => {
  if (typeof h === 'string') h = { id: h };
  if (!h.id) return h;
  const obj = catalog && catalog[h.id];
  if (!obj) return null;
  return Object.assign({}, obj, { label: h.label != null ? h.label : h.id }, h);
};

{
  const d = makeStepDisplay({ highlight: ['Betelgeuse'] }, CAT);
  const o = oracleResolve('Betelgeuse', CAT);
  check("a bare string becomes a circle mark carrying the catalog position", eq(noKeys(d.marks), [
    { kind: 'circle', ra: o.ra, dec: o.dec, arcmin: undefined, color: o.color, label: o.label },
  ]), JSON.stringify(d.marks));
  check('a bare string labels itself with its id', d.marks[0].label === 'Betelgeuse');
}

{
  const d = makeStepDisplay({ highlight: [{ id: 'Betelgeuse', label: '' }] }, CAT);
  check('an empty label stays empty rather than falling back to the id',
    d.marks[0].label === '', JSON.stringify(d.marks[0].label));
}

{
  const d = makeStepDisplay({ highlight: [{ id: 'M42', label: 'Orion Nebula' }] }, CAT);
  check('an extended object carries its angular size for the draw-time radius',
    d.marks[0].arcmin === 85 && d.marks[0].label === 'Orion Nebula');
}

{
  const d = makeStepDisplay({ highlight: [{ id: 'Betelgeuse', color: '#123456' }] }, CAT);
  check('an explicit colour overrides the catalog colour', d.marks[0].color === '#123456');
  const n = makeStepDisplay({ highlight: ['Nocolor'] }, CAT);
  check('a catalog object with no colour yields no colour', n.marks[0].color === undefined);
}

{
  const d = makeStepDisplay({ highlight: ['Nosuchstar', 'Rigel'] }, CAT);
  check('an unresolvable highlight is dropped and reported',
    d.marks.length === 1 && d.marks[0].label === 'Rigel'
      && d.problems.length === 1 && /Nosuchstar/.test(d.problems[0]),
    `${d.marks.length} marks, problems: ${JSON.stringify(d.problems)}`);
}

{
  check('no highlight field yields no marks', eq(makeStepDisplay({}, CAT).marks, []));
}

// ---- Cycle 4: crosshair and line marks --------------------------------------
// ORACLE: the painter's branch order — capsule, then resolve, then line, then
// crosshair, then circle (guide-renderer.js).
{
  const d = makeStepDisplay({ highlight: [{ id: 'Betelgeuse', crosshair: true, label: 'Pole' }] }, CAT);
  check("a crosshair entry becomes a crosshair mark", eq(noKeys(d.marks), [
    { kind: 'crosshair', ra: 88.79, dec: 7.41, color: '#ffa04d', label: 'Pole' },
  ]), JSON.stringify(d.marks));
}

{
  // Preserved-but-ignored: the painter hardcodes the crosshair colour. The value
  // carries what the data said so a validator can see it; the painter still ignores it.
  const d = makeStepDisplay({ highlight: [{ id: 'Betelgeuse', crosshair: true, color: '#abcdef' }] }, CAT);
  check('a crosshair carries the colour the painter ignores', d.marks[0].color === '#abcdef');
}

{
  const step = { highlight: [{ line: [[326.19, 54.21], [317.38, 48.12], [310.6, 45.78]], label: 'Great Rift', color: '#555555' }] };
  const d = makeStepDisplay(step, CAT);
  check("a line entry becomes a line mark with its own coordinates", eq(noKeys(d.marks), [
    { kind: 'line',
      points: [{ ra: 326.19, dec: 54.21 }, { ra: 317.38, dec: 48.12 }, { ra: 310.6, dec: 45.78 }],
      color: '#555555', label: 'Great Rift' },
  ]), JSON.stringify(d.marks));
}

{
  // A line entry has no id, so it never reaches the catalog and cannot be unresolvable.
  const d = makeStepDisplay({ highlight: [{ line: [[1, 2], [3, 4]] }] }, CAT);
  check('a line entry needs no catalog', d.marks.length === 1 && d.problems.length === 0);
}

// ---- Cycle 5: capsule marks -------------------------------------------------
// ORACLE: the painter's capsule branch, which resolves its own elements rather than
// going through guideResolveHighlight — so a capsule point does NOT default its label
// to the id. Three element shapes appear in the data: "Name", {id}, {id,label}.
{
  const d = makeStepDisplay({ highlight: [{ capsule: ['Mintaka', 'Alnitak'] }] }, CAT);
  check("a capsule resolves each element and keeps them ordered", eq(noKeys(d.marks), [
    { kind: 'capsule',
      points: [{ ra: 83.00, dec: -0.30, arcmin: undefined, label: undefined },
               { ra: 85.19, dec: -1.94, arcmin: undefined, label: undefined }],
      color: '#fff', label: undefined, margin: undefined },
  ]), JSON.stringify(d.marks));
}

{
  const d = makeStepDisplay({ highlight: [{ capsule: ['Mintaka', { id: 'Alnitak', label: 'end' }] }] }, CAT);
  check('a capsule point carries its own label and does not default to the id',
    d.marks[0].points[0].label === undefined && d.marks[0].points[1].label === 'end');
}

{
  const d = makeStepDisplay({ highlight: [{ capsule: ['Mintaka', 'Alnitak'], color: '#c8d8ff', label: 'belt' }] }, CAT);
  check('a capsule carries its mark-level colour and label',
    d.marks[0].color === '#c8d8ff' && d.marks[0].label === 'belt');
}

{
  const d = makeStepDisplay({ highlight: [{ capsule: ['Mintaka', 'Alnitak'], margin: 0 }] }, CAT);
  check('a zero margin survives — it is a real value, not an absent one',
    d.marks[0].margin === 0, JSON.stringify(d.marks[0].margin));
}

{
  const d = makeStepDisplay({ highlight: [{ capsule: ['Mintaka', 'Nosuchstar', 'Alnitak'] }] }, CAT);
  check('an unresolvable capsule element drops just that point and is reported',
    d.marks[0].points.length === 2 && d.problems.length === 1 && /Nosuchstar/.test(d.problems[0]),
    `${d.marks[0].points.length} points, problems: ${JSON.stringify(d.problems)}`);
}

{
  const d = makeStepDisplay({ highlight: [{ capsule: ['Mintaka', 'Nosuchstar'] }] }, CAT);
  check('a capsule left with fewer than two points is dropped whole',
    d.marks.length === 0, JSON.stringify(d.marks));
}

// ---- Cycle 6: the precession circle as a mark kind --------------------------
// ORACLE: the painter draws it when the field is truthy, southern when it reads
// 'south', and draws it BEFORE the highlight loop.
{
  const s = makeStepDisplay({ precessionCircle: 'south' }, CAT);
  const n = makeStepDisplay({ precessionCircle: 'north' }, CAT);
  check('the precession circle becomes a mark', eq(s.marks, [{ kind: 'precession', south: true }])
    && eq(n.marks, [{ kind: 'precession', south: false }]),
    JSON.stringify([s.marks, n.marks]));
}

{
  const d = makeStepDisplay({ precessionCircle: 'north', highlight: ['Rigel'] }, CAT);
  check('the precession circle is drawn before the highlights, so it comes first',
    d.marks[0].kind === 'precession' && d.marks[1].kind === 'circle',
    d.marks.map(m => m.kind).join(','));
}

{
  check('no precession field yields no precession mark',
    makeStepDisplay({ highlight: ['Rigel'] }, CAT).marks.every(m => m.kind !== 'precession'));
}

// ---- Cycle 7: unknown keys become problems ----------------------------------
// A field nobody reads is invisible in the browser; here it is data a test can fail on.
{
  const d = makeStepDisplay({ highlight: [{ capsule: ['Mintaka', 'Alnitak'], r: 10 }] }, CAT);
  check('a highlight key nothing reads is reported',
    d.problems.length === 1 && /\br\b/.test(d.problems[0]), JSON.stringify(d.problems));
}

{
  const every = { id: 'Rigel', label: 'x', color: '#fff', crosshair: true, margin: 2 };
  check('the keys the painter actually reads are not reported',
    makeStepDisplay({ highlight: [every] }, CAT).problems.length === 0,
    JSON.stringify(makeStepDisplay({ highlight: [every] }, CAT).problems));
  check('a capsule element may carry id and label',
    makeStepDisplay({ highlight: [{ capsule: [{ id: 'Mintaka', label: 'a' }, { id: 'Alnitak' }] }] }, CAT).problems.length === 0);
}

{
  const d = makeStepDisplay({ highlight: [{ capsule: [{ id: 'Mintaka', bogus: 1 }, 'Alnitak'] }] }, CAT);
  check('an unknown capsule element key is reported',
    d.problems.length === 1 && /bogus/.test(d.problems[0]), JSON.stringify(d.problems));
}

// ---- Cycle 8: intersectDisplays ---------------------------------------------
// What stays lit while the camera flies between steps. ORACLE: _guideIntersectSettings,
// _intersectFilter and _guideIntersectAnnotation, transcribed verbatim, then normalized
// through makeStepDisplay so the two representations can be compared.
const oracleIntersectFilter = (a, b) => {
  if (Array.isArray(a) && Array.isArray(b)) {
    const s = new Set(a);
    const shared = b.filter(x => s.has(x));
    return shared.length ? shared : undefined;
  }
  return a && b;
};
const oracleIntersectSettings = (a, b) => {
  const result = {
    photo:   a.photo && b.photo,
    diagram: oracleIntersectFilter(a.diagram, b.diagram),
    bounds:  oracleIntersectFilter(a.bounds, b.bounds),
    art:     oracleIntersectFilter(a.art, b.art),
    names:   oracleIntersectFilter(a.names, b.names),
  };
  if (a.lines?.length && b.lines?.length) {
    const aSet = new Set(a.lines.map(l => l.join('|')));
    const shared = b.lines.filter(l => aSet.has(l.join('|')));
    if (shared.length) { result.lines = shared; result.lineColor = b.lineColor; result.lineWidth = b.lineWidth; }
  }
  return result;
};

// Sweep every layer-value pairing against the oracle.
{
  const VALUES = [undefined, true, false, ['Ori'], ['Ori', 'Tau'], ['Tau'], ['Lyr']];
  let ok = true, detail = '';
  for (const av of VALUES) {
    for (const bv of VALUES) {
      const stepA = {}, stepB = {};
      if (av !== undefined) stepA.bounds = av;
      if (bv !== undefined) stepB.bounds = bv;
      const got = intersectDisplays(makeStepDisplay(stepA, CAT), makeStepDisplay(stepB, CAT)).layers.bounds;
      const want = makeStepDisplay({ bounds: oracleIntersectSettings(stepA, stepB).bounds }, CAT).layers.bounds;
      if (!eq(got, want)) { ok = false; detail = `${JSON.stringify(av)} ∩ ${JSON.stringify(bv)}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`; }
    }
  }
  check('layer intersection matches the pre-refactor filter over all pairings', ok, detail);
}

{
  const a = makeStepDisplay({ lines: [['Mintaka', 'Alnitak'], ['Rigel', 'Betelgeuse']] }, CAT);
  const b = makeStepDisplay({ lines: [['Rigel', 'Betelgeuse']], lineColor: '#b', lineWidth: 3 }, CAT);
  const r = intersectDisplays(a, b);
  check('shared guide-line segments survive, carrying the destination step\'s style',
    r.lines.segments.length === 1 && eq(r.lines.segments[0].names, ['Rigel', 'Betelgeuse'])
      && r.lines.color === '#b' && r.lines.width === 3,
    JSON.stringify(r.lines));
}

{
  const a = makeStepDisplay({ lines: [['Mintaka', 'Alnitak']] }, CAT);
  const b = makeStepDisplay({ lines: [['Rigel', 'Betelgeuse']] }, CAT);
  check('disjoint guide lines leave none', intersectDisplays(a, b).lines === null);
  check('one side without guide lines leaves none',
    intersectDisplays(a, makeStepDisplay({}, CAT)).lines === null);
}

{
  const a = makeStepDisplay({ highlight: ['Rigel', 'Betelgeuse'] }, CAT);
  const b = makeStepDisplay({ highlight: ['Betelgeuse', 'Mintaka'] }, CAT);
  const r = intersectDisplays(a, b);
  check('marks shared by identity survive the flight',
    r.marks.length === 1 && r.marks[0].label === 'Betelgeuse', JSON.stringify(r.marks));
}

{
  const a = makeStepDisplay({ highlight: ['Rigel'] }, CAT);
  const b = makeStepDisplay({ highlight: ['Mintaka'] }, CAT);
  check('marks sharing nothing leave none', eq(intersectDisplays(a, b).marks, []));
}

{
  const a = makeStepDisplay({ precessionCircle: 'north', highlight: ['Rigel'] }, CAT);
  const b = makeStepDisplay({ precessionCircle: 'north', highlight: ['Rigel'] }, CAT);
  check('the precession circle never survives a transition — the pre-refactor intersection carried only highlights',
    intersectDisplays(a, b).marks.every(m => m.kind !== 'precession'),
    JSON.stringify(intersectDisplays(a, b).marks));
}

// ---- Cycle 9: hasOverlays and displayWithoutOverlays ------------------------
// "Overlays" keeps its existing user-facing sense: everything the step display turns on
// EXCEPT the photo — that is what the Hide overlays button leaves behind.
// ORACLE: _stepHasOverlays, transcribed. It omits precessionCircle; the query does not,
// which is the one deliberate divergence (see the last case).
const oracleHasOverlays = (step) =>
  !!(step.diagram || step.art || step.names || step.bounds || step.highlight?.length || step.lines?.length);

{
  const STEPS = [
    {}, { photo: true }, { diagram: true }, { art: ['Ori'] }, { names: true }, { bounds: true },
    { highlight: ['Rigel'] }, { lines: [['Mintaka', 'Alnitak']] },
    { photo: true, diagram: false }, { photo: true, highlight: ['Rigel'] },
  ];
  let ok = true, detail = '';
  for (const step of STEPS) {
    const got = hasOverlays(makeStepDisplay(step, CAT));
    const want = oracleHasOverlays(step);
    if (got !== want) { ok = false; detail = `${JSON.stringify(step)}: got ${got} want ${want}`; }
  }
  check('hasOverlays matches the pre-refactor field list', ok, detail);
}

{
  check('the photo alone is not an overlay — it is what hiding them leaves',
    hasOverlays(makeStepDisplay({ photo: true }, CAT)) === false);
}

{
  // The deliberate divergence: the pre-refactor list forgot precessionCircle. No
  // behaviour changes today — both precession steps also carry a highlight, which is
  // what masked it — but the query cannot forget a kind the way a list can.
  const step = { precessionCircle: 'north' };
  check('a precession-only step now counts as having overlays',
    hasOverlays(makeStepDisplay(step, CAT)) === true && oracleHasOverlays(step) === false);
}

{
  const full = makeStepDisplay({
    photo: true, diagram: true, bounds: ['Ori'], names: true, art: true,
    highlight: ['Rigel'], lines: [['Mintaka', 'Alnitak']],
  }, CAT);
  const bare = displayWithoutOverlays(full);
  check('hiding overlays keeps the photo and drops everything else',
    eq(bare.layers.photo, { on: true, only: null })
      && ['diagram', 'bounds', 'names', 'art'].every(k => eq(bare.layers[k], { on: false, only: null }))
      && bare.lines === null && eq(bare.marks, []),
    JSON.stringify(bare));
  check('hiding overlays leaves nothing hasOverlays can see', hasOverlays(bare) === false);
  check('hiding overlays does not mutate the display it was given',
    hasOverlays(full) === true && full.lines !== null && full.marks.length === 1);
}

{
  const off = displayWithoutOverlays(makeStepDisplay({ diagram: true }, CAT));
  check('a step without a photo stays without one', eq(off.layers.photo, { on: false, only: null }));
}

// ---- Cycle 10: the real guide data ------------------------------------------
// Replay the frozen capture: a change in normalization, or in the guide data, shows up
// as a diff. This is a regression freeze on makeStepDisplay's OUTPUT, and it stays here.
//
// The data GATE moved to test/guide-source.js (#90). It used to sit in this block too,
// asserting `problems` empty — but only over the nine fields this module reads. A step
// declares two independent things (CONTEXT.md), and the other six had no gate at all, so
// a maintainer editing the JSON got half an answer from here and no answer about the
// rest. One walk over the whole 15-field schema now lives beside the guide source, which
// owns the other half. Different question, different home: this file asks "does
// makeStepDisplay still normalize the way it did?", that one asks "is the data sound?".
{
  const guides  = JSON.parse(fs.readFileSync(path.join(jsDir, 'finding-guides.json'), 'utf8'));
  const catalog = JSON.parse(fs.readFileSync(path.join(jsDir, 'sky-objects.json'), 'utf8'));
  const golden  = JSON.parse(fs.readFileSync(path.join(__dirname, 'step-display-golden.json'), 'utf8'));

  const built = [];
  for (const [name, guide] of Object.entries(guides)) {
    (guide.steps || []).forEach((step, i) => built.push({ label: `${name}#${i}`, display: makeStepDisplay(step, catalog) }));
  }

  check(`golden covers every step (${golden.length})`, built.length === golden.length,
    `built ${built.length}, golden ${golden.length}`);

  let mismatches = 0, first = '';
  for (let i = 0; i < Math.min(built.length, golden.length); i++) {
    if (!eq(built[i], golden[i])) {
      mismatches++;
      if (!first) first = `${golden[i].label}: got ${JSON.stringify(built[i].display).slice(0, 200)}`;
    }
  }
  check('golden replay byte-for-byte', mismatches === 0, `${mismatches} steps differ — ${first}`);
}

console.log('');
if (failures.length === 0) { console.log('✅ ALL PASSED'); process.exit(0); }
else { console.log(`❌ ${failures.length} FAILURE(S)`); process.exit(1); }
