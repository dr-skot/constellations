#!/usr/bin/env node
// The constellation viewer keeps its own state (issue #73).
//
// Before this, viewing a constellation wrote a one-question LESSON SESSION, marked
// that question answered, set its rotation and turned the learner's Photo toggle off —
// because the viewer had no state of its own and borrowed the quiz's. A learner who
// looked something up mid-course had their lesson's reveal quietly reconfigured.
//
// Two things are asserted here: what the viewer asks the reveal for, and that its
// layer choices are nobody else's.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const jsDir = path.join(__dirname, '..', 'js');

// The quiz's toggles live in render.js, which needs a browser; the two lines that
// declare them are all this test needs from it, so they are stood up directly rather
// than dragging a canvas in. viewer.js itself touches no DOM until it is called.
global.revState = { photo: true, diagram: true, art: true, boundary: true };
global.diagramSource = 'iau';
global.session = { rotation: 1.2, answered: true, questions: [], idx: 0 };
vm.runInThisContext(fs.readFileSync(path.join(jsDir, 'viewer.js'), 'utf8'), { filename: 'viewer.js' });

const failures = [];
const check = (name, ok, detail) => ok ? console.log(`OK: ${name}`)
  : (failures.push(name), console.log(`FAIL: ${name}` + (detail ? ` — ${detail}` : '')));

// 1. A constellation you looked up sits north-up. A question's rotation is the
//    question's business — the viewer is not a question.
{
  const intent = viewerIntent();
  check('the viewer shows a constellation north-up', intent.rotation === 0, String(intent.rotation));
  check('a lesson question\'s rotation does not reach the viewer',
    intent.rotation !== session.rotation, `session.rotation ${session.rotation}`);
  check('the viewer asks for the diagram, not a quiz mode', intent.mode === 'diagram', intent.mode);
  check('the viewer carries the learner\'s figure set', intent.source === 'iau', String(intent.source));
}

// 2. The layers are the viewer's own. Turning the photograph off here must not turn it
//    off in the learner's lesson — the contamination this ticket removes.
{
  viewerLayers.photo = false;
  check('the viewer\'s layers are its own', revState.photo === true,
    `revState.photo ${revState.photo}`);
  check('and the viewer asks for what it was set to', viewerIntent().layers.photo === false);

  revState.art = false;
  check('and the quiz\'s layers do not reach the viewer', viewerIntent().layers.art === true);
  viewerLayers.photo = true; revState.art = true;
}

// 3. The intent is a fresh value, not the state itself — a caller cannot reach through
//    it and change what the viewer is showing.
{
  const intent = viewerIntent();
  intent.layers.diagram = false;
  check('the intent does not alias the viewer\'s state', viewerLayers.diagram === true);
}

// 4. Nothing in the viewer writes the lesson session. A source check, in the spirit of
//    the content-invariant tests already in this directory: the point of the ticket is
//    that this module cannot disturb a lesson, and the cheapest true statement of that
//    is that it never assigns to one.
{
  const src = fs.readFileSync(path.join(jsDir, 'viewer.js'), 'utf8');
  const writes = src.match(/\bsession\.[A-Za-z]+\s*=[^=]/g) || [];
  check('the viewer writes nothing to the lesson session', writes.length === 0, writes.join(', '));
}

console.log('');
if (failures.length === 0) { console.log('✅ ALL PASSED'); process.exit(0); }
else { console.log(`❌ ${failures.length} FAILURE(S)`); process.exit(1); }
