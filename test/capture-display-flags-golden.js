#!/usr/bin/env node
// Characterization capture for resolveDisplayFlags (Candidate 5, part B).
//
// resolveOriginal below is a VERBATIM transcription of the inline show* cascade
// in drawExplore (js/explore.js lines 337-345 pre-refactor). It is the ORACLE:
// run over a wide cross-product of display states, its output is frozen as
// test/display-flags-golden.json. After the pure resolveDisplayFlags is extracted,
// test/display-flags.js replays this golden through the real function and asserts
// byte-for-byte equality. Do NOT "improve" the logic here — it must mirror the
// pre-refactor code exactly.

const fs = require('fs');
const path = require('path');

// ---- ORACLE: exact copy of the pre-refactor inline cascade ------------------
function resolveOriginal(explore, exState, eqRevState, guideActive) {
  const q = explore.quiz;
  const cm = q?.stageMode;
  const isAnswered = !!(q?.answered);
  const _gs = guideActive;
  const showPhoto      = cm ? (isAnswered ? eqRevState.photo    : cm === 'photo')   : explore.photo !== undefined ? !!explore.photo : exState.photo;
  const showDiag       = cm ? (isAnswered ? eqRevState.diagram  : cm !== 'photo')   : true;
  const showStars      = cm ? showDiag : explore.diagram !== undefined ? !!explore.diagram : exState.stars;
  const showLines      = cm ? (isAnswered ? showDiag            : cm === 'diagram') : explore.diagram !== undefined ? !!explore.diagram : exState.diagram;
  const showBounds     = cm ? (isAnswered ? eqRevState.boundary : !!q.bounds)       : explore.bounds !== undefined ? !!explore.bounds : exState.bounds;
  const showArt        = cm ? (isAnswered ? eqRevState.art      : false)            : explore.art !== undefined ? !!explore.art : exState.art;
  const showStarLabels = (cm || _gs) ? false : exState.starLabels;
  const showConNames   = cm ? false : explore.names !== undefined ? !!explore.names : exState.conNames;
  const _refMode       = cm ? 'always' : explore.equator !== undefined ? (explore.equator ? 'always' : null) : exState.reference;
  return { cm, isAnswered, showPhoto, showDiag, showStars, showLines, showBounds, showArt, showStarLabels, showConNames, refMode: _refMode };
}

// ---- Input space ------------------------------------------------------------
const defExState = () => ({ photo: true, stars: true, diagram: true, art: true, bounds: true, starLabels: true, conNames: true, reference: 'always' });
const defEqRev   = () => ({ photo: true, diagram: true, art: true, boundary: true });
const tri  = [undefined, true, false];
const refs = ['always', 'moving', null];
const overrideProps = ['photo', 'diagram', 'bounds', 'art', 'names', 'equator'];
const exStateBools  = ['photo', 'stars', 'diagram', 'art', 'bounds', 'starLabels', 'conNames'];

const scenarios = [];
const add = (label, explore, exState, eqRevState, guideActive) =>
  scenarios.push({ label, explore, exState, eqRevState, guideActive });

// --- Free mode (no quiz) -----------------------------------------------------
// Baseline + each explore override prop swept over {undefined,true,false}.
for (const prop of overrideProps) {
  for (const v of tri) {
    const explore = { quiz: null };
    if (v !== undefined) explore[prop] = v;
    else explore[prop] = undefined;
    add(`free/override:${prop}=${String(v)}`, explore, defExState(), defEqRev(), false);
  }
}
// Array-valued overrides (truthy path) — arrays are how find-help filters layers.
add('free/override:bounds=[Ori]',  { quiz: null, bounds:  ['Ori'] }, defExState(), defEqRev(), false);
add('free/override:diagram=[Ori]', { quiz: null, diagram: ['Ori'] }, defExState(), defEqRev(), false);
add('free/override:names=[Ori]',   { quiz: null, names:   ['Ori'] }, defExState(), defEqRev(), false);
add('free/override:art=[Ori]',     { quiz: null, art:     ['Ori'] }, defExState(), defEqRev(), false);
// reference sweep.
for (const r of refs) { const es = defExState(); es.reference = r; add(`free/ref=${String(r)}`, { quiz: null }, es, defEqRev(), false); }
// exState booleans toggled one at a time (both polarities), overrides absent.
for (const k of exStateBools) {
  for (const b of [true, false]) { const es = defExState(); es[k] = b; add(`free/exState:${k}=${b}`, { quiz: null }, es, defEqRev(), false); }
}
// guideActive suppresses star labels.
add('free/guideActive', { quiz: null }, defExState(), defEqRev(), true);

// --- Course mode, unanswered -------------------------------------------------
for (const sm of ['photo', 'diagram', 'stars']) {
  for (const qb of [undefined, true, false, ['Ori']]) {
    const quiz = { stageMode: sm, answered: false };
    quiz.bounds = qb;
    add(`course/unanswered:${sm}/bounds=${Array.isArray(qb) ? '[Ori]' : String(qb)}`, { quiz }, defExState(), defEqRev(), false);
  }
  // guideActive still forces star labels off (cm already does, but cross it).
  add(`course/unanswered:${sm}/guide`, { quiz: { stageMode: sm, answered: false, bounds: true } }, defExState(), defEqRev(), true);
}

// --- Course mode, answered: full 2^4 eqRevState cross-product x 3 stageModes --
for (const sm of ['photo', 'diagram', 'stars']) {
  for (let mask = 0; mask < 16; mask++) {
    const eq = { photo: !!(mask & 1), diagram: !!(mask & 2), art: !!(mask & 4), boundary: !!(mask & 8) };
    add(`course/answered:${sm}/eqRev=${mask}`, { quiz: { stageMode: sm, answered: true, bounds: true } }, defExState(), eq, false);
  }
}

// ---- Capture ----------------------------------------------------------------
const golden = scenarios.map(s => ({
  label: s.label,
  input: { explore: s.explore, exState: s.exState, eqRevState: s.eqRevState, guideActive: s.guideActive },
  flags: resolveOriginal(s.explore, s.exState, s.eqRevState, s.guideActive),
}));

const out = path.join(__dirname, 'display-flags-golden.json');
fs.writeFileSync(out, JSON.stringify(golden, null, 2) + '\n');
console.log(`Captured ${golden.length} scenarios -> ${path.relative(process.cwd(), out)}`);
