#!/usr/bin/env node
// Characterization test for resolveReveal (js/reveal.js, issue #71).
//
// The reveal — what an answered question and the constellation viewer both show —
// used to work out what to draw INSIDE the painter, by reading the lesson session,
// the quiz's reveal toggles, the quiz mode and the app-global diagram source. That
// is what stopped it being shareable: the viewer had to fake an answered question to
// borrow it.
//
// resolveOriginal below is a VERBATIM transcription of those decisions as they stood
// before the extraction (js/render.js redrawReveal, pre-refactor lines 407-442, 470
// and 554). It is the oracle: an independent statement of the behaviour, swept over
// every combination of inputs the app can produce. Following the pattern of
// test/display-flags.js, which did the same for the explorer's draw flags.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const jsDir = path.join(__dirname, '..', 'js');
vm.runInThisContext(fs.readFileSync(path.join(jsDir, 'reveal.js'), 'utf8'), { filename: 'reveal.js' });

const failures = [];
const check = (name, ok, detail) => ok ? console.log(`OK: ${name}`)
  : (failures.push(name), console.log(`FAIL: ${name}` + (detail ? ` — ${detail}` : '')));

const KEYS = ['rotation', 'background', 'showLines', 'showStars', 'showArt', 'showBounds',
              'showStarLabels', 'source'];

// ---- The oracle -------------------------------------------------------------
// Transcribed from the painter, decision by decision:
//   showBound/showDiag/showArt/showPhoto  ← the four reveal toggles
//   angle                                 ← session.rotation || 0
//   background   photo when the toggle is on AND the photograph has loaded;
//                otherwise the generated sky, star-field styled only in stars mode
//   art          only when the toggle is on and the artwork has loaded
//   lines        the diagram toggle
//   stars        !showPhoto || showDiag   ← deliberately the TOGGLE, not whether the
//                photograph actually drew; a reveal with the photo toggled on but
//                still loading draws no stars
//   bounds       the boundary toggle
//   star labels  the diagram toggle (the projection is always computed)
function resolveOriginal({ layers, mode, rotation, source, photoReady, artReady }) {
  const showBound = layers.boundary;
  const showDiag  = layers.diagram;
  const showArt   = layers.art;
  const showPhoto = layers.photo;
  const angle = rotation || 0;
  const background = (showPhoto && photoReady) ? 'photo' : (mode === 'stars' ? 'stars' : 'gradient');
  return {
    rotation: angle,
    background,
    showLines: showDiag,
    showStars: !showPhoto || showDiag,
    showArt: showArt && artReady,
    showBounds: showBound,
    showStarLabels: showDiag,
    source,
  };
}

// ---- The sweep --------------------------------------------------------------
// Every combination the app can hand it: four toggles, three quiz modes, and the two
// asynchronous facts (has the photograph loaded, has the artwork loaded).
{
  const BOOL = [true, false];
  const MODES = ['diagram', 'photo', 'stars'];
  let cases = 0, bad = 0, detail = '';
  for (const photo of BOOL) for (const diagram of BOOL) for (const art of BOOL) for (const boundary of BOOL) {
    for (const mode of MODES) for (const photoReady of BOOL) for (const artReady of BOOL) {
      const input = { layers: { photo, diagram, art, boundary }, mode, rotation: 0.4,
                      source: 'stellarium', photoReady, artReady };
      const want = resolveOriginal(input);
      const got  = resolveReveal(input);
      cases++;
      for (const k of KEYS) {
        if (got[k] !== want[k]) {
          bad++;
          if (!detail) detail = `${JSON.stringify(input.layers)} mode=${mode} photoReady=${photoReady} artReady=${artReady} ${k}: got ${JSON.stringify(got[k])} want ${JSON.stringify(want[k])}`;
        }
      }
    }
  }
  check(`matches the pre-extraction painter on every input (${cases} cases)`, bad === 0, detail);
}

// ---- The decisions worth naming ---------------------------------------------
const layers = (over = {}) => ({ photo: true, diagram: true, art: true, boundary: true, ...over });
const reveal = (over = {}) => resolveReveal({
  layers: layers(over.layers), mode: over.mode || 'diagram', rotation: over.rotation || 0,
  source: over.source || 'stellarium',
  photoReady: over.photoReady !== undefined ? over.photoReady : true,
  artReady: over.artReady !== undefined ? over.artReady : true,
});

// 1. A photograph that has not arrived falls back to the generated sky.
{
  check('the photograph draws when it is on and loaded', reveal().background === 'photo');
  check('a photograph still loading falls back to the generated sky',
    reveal({ photoReady: false }).background === 'gradient', reveal({ photoReady: false }).background);
  check('the star-field background belongs to stars mode',
    reveal({ layers: { photo: false }, mode: 'stars' }).background === 'stars');
}

// 2. The stars question asks the TOGGLE, not whether the photograph drew. A learner
//    with the photograph on and still loading sees neither photograph nor stars —
//    faithfully preserved, because changing it would change what a reveal looks like.
{
  check('a photograph still loading does not bring the stars back',
    reveal({ layers: { diagram: false }, photoReady: false }).showStars === false);
  check('the diagram toggle brings the stars back over a photograph',
    reveal({ layers: { diagram: true } }).showStars === true);
  check('no photograph means stars', reveal({ layers: { photo: false, diagram: false } }).showStars === true);
}

// 3. Artwork that has not loaded is not drawn, however the toggle stands.
{
  check('artwork needs both the toggle and the image', reveal({ artReady: false }).showArt === false);
  check('artwork off is off', reveal({ layers: { art: false } }).showArt === false);
}

// 4. Star labels follow the diagram, neighbour labels follow the boundary.
{
  check('star labels follow the diagram toggle',
    reveal({ layers: { diagram: false } }).showStarLabels === false && reveal().showStarLabels === true);
  check('the boundary toggle carries its own decision',
    reveal({ layers: { boundary: false } }).showBounds === false);
}

// 5. The figure set travels with the reveal rather than being read from a global.
{
  check('the figure set is carried', reveal({ source: 'rey' }).source === 'rey');
}

// 6. Housekeeping.
{
  const input = { layers: layers(), mode: 'diagram', rotation: 0, source: 'stellarium',
                  photoReady: true, artReady: true };
  const snap = JSON.stringify(input);
  const a = resolveReveal(input);
  const b = resolveReveal(input);
  check('does not mutate its input', JSON.stringify(input) === snap);
  check('is deterministic', JSON.stringify(a) === JSON.stringify(b));
  check('returns every key', KEYS.every(k => k in a), KEYS.filter(k => !(k in a)).join(','));
}

console.log('');
if (failures.length === 0) { console.log('✅ ALL PASSED'); process.exit(0); }
else { console.log(`❌ ${failures.length} FAILURE(S)`); process.exit(1); }
