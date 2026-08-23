#!/usr/bin/env node
// One owner for the lesson-session key (issue #91).
//
// js/quiz.js's adapter comment claims the layer "owns sessionStorage" for the lesson
// session — saveLessonSession writes the key, tryResumeLesson reads it. But three other
// files deleted it directly, so the layer did not own it:
//
//   js/course.js         endLesson()              the lesson is over        "finished"
//   js/main.js           "Reset all progress"     erase everything          "erased"
//   js/calibration-ui.js before navigate('lesson') fresh lesson on a seed   "superseded"
//
// Five production sites named the string; two were the owner and three were not.
//
// The risk was never the key changing. saveLessonSession carries a policy — only a lesson
// persists (#92) — and the three removals carried none. A second policy attached to
// clearing would have to be found and re-applied in three files by someone with no reason
// to look for them.
//
// FINDING, recorded because the ticket asked the question rather than assuming: the three
// callers really do want the same operation. Their REASONS differ, but all three want "no
// resumable lesson in storage", none carries an extra condition, and all three are
// load-bearing rather than defensive — the result screen's next-lesson button routes
// through navigate('lesson'), so without endLesson's clear it would resume the lesson that
// just finished. One function is the right answer, not a papering-over.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── Stubs ────────────────────────────────────────────────────────────────────
const ss = {};
global.sessionStorage = {
  getItem: k => (k in ss ? ss[k] : null),
  setItem: (k, v) => { ss[k] = v; },
  removeItem: k => { delete ss[k]; },
};
global.document = { getElementById: () => ({ textContent: '', style: {}, classList: { add(){}, remove(){}, toggle(){} } }) };

const jsDir = path.join(__dirname, '..', 'js');
const origLog = console.log; console.log = () => {};
vm.runInThisContext(fs.readFileSync(path.join(jsDir, 'lesson-session.js'), 'utf8'),
                    { filename: 'lesson-session.js' });
vm.runInThisContext(fs.readFileSync(path.join(jsDir, 'quiz.js'), 'utf8'), { filename: 'quiz.js' });
console.log = origLog;

const failures = [];
const check = (name, ok, detail) => ok ? console.log(`OK: ${name}`)
  : (failures.push(name), console.log(`FAIL: ${name}` + (detail ? ` — ${detail}` : '')));

const KEY = 'lesson-session';
const stored = () => sessionStorage.getItem(KEY);

// A catalog small enough to resolve the one abbr the fixture uses.
global.C = [{ abbr: 'Ori', name: 'Orion', ra: 5.5, dec: 0, fov: 30, diff: 0, hem: 'B' }];

// tryResumeLesson renders on success and swallows anything that throws — its whole body
// is inside one try/catch. Left unstubbed, showLessonQuestion throws on the DOM stub and
// resume answers FALSE for that reason instead of the one under test, so "nothing can be
// resumed" would pass with the key still sitting there. That is the tautology shape from
// #92, and it was caught here by gutting clearLessonSession and watching which assertions
// stayed green. Stubbed, so a false answer can only mean there was nothing to resume.
showLessonQuestion = () => {};

function aLesson() {
  session.questions = [{ con: C[0], type: 'identify', mode: 'diagram', answerMode: 'choice' }];
  session.idx = 0;
  session.correct = 0;
  session.history = [];
  session.lessonLabel = 'Test Lesson';
  session.run = RUN_LESSON;
}

// ── 1. The verb exists and forgets the lesson ────────────────────────────────
{
  check('clearLessonSession is a function', typeof clearLessonSession === 'function');

  aLesson();
  saveLessonSession();
  check('a lesson persists to begin with', stored() != null);
  // The control for the assertion below: with the key present, resume SUCCEEDS. Without
  // this the false answer afterwards proves nothing — it would read the same way if
  // resume were simply broken.
  check('and while it is there, resume succeeds', tryResumeLesson() === true);

  clearLessonSession();
  check('clearing removes the key', stored() === null, JSON.stringify(stored()));
  check('and nothing can be resumed from it', tryResumeLesson() === false);
}

// ── 2. Clearing is idempotent ────────────────────────────────────────────────
// All three callers fire on paths that may have nothing stored — a level check never
// writes one, and Reset is reachable with no lesson ever started. Clearing nothing must
// be quiet, not a throw on a screen the learner is already leaving.
{
  clearLessonSession();
  let threw = false;
  try { clearLessonSession(); } catch { threw = true; }
  check('clearing an absent session does not throw', threw === false);
  check('and leaves it absent', stored() === null);
}

// ── 3. It clears STORAGE, not the run ────────────────────────────────────────
// Deliberately narrow. endLesson clears the key and then renders the result screen off
// the spent lesson still in memory, so "no resumable session" must not mean "no lesson
// object". Widening this to touch session.run would break that, and the stickiness of a
// finished run is out of scope here exactly as it was in #92.
{
  aLesson();
  saveLessonSession();
  clearLessonSession();
  check('the run is untouched', isLesson(session) === true, session.run);
  check('the questions are untouched', session.questions.length === 1);
  check('the score is untouched', session.correct === 0);
}

// ── 4. A cleared session is re-savable ───────────────────────────────────────
// The calibration hand-off clears and then starts a fresh lesson immediately; clearing
// must not leave the adapter in a state where the next save is a no-op.
{
  aLesson();
  clearLessonSession();
  saveLessonSession();
  check('a fresh lesson persists after a clear', stored() != null);
  clearLessonSession();
}

// ── 5. Nothing outside quiz.js names the key ─────────────────────────────────
// The point of the ticket, and the half that is easy to get wrong. Scope is not a detail
// of this assertion, it IS the assertion — #92 shipped a sweep that fired correctly for
// six names while scanning the wrong directories, and the first draft of THIS one repeated
// the mistake in a narrower form: js/ and perf/ but no pages, in a file whose own comment
// cited #92 for that error. The pages carry live inline <script> blocks — index.html's
// ?perf=1 loader, find-help.html's boot read, and perf/step.html, which loads quiz.js,
// course.js and calibration-ui.js and drives the app — so a removeItem added to any of
// them would have passed green.
//
// Matches any quote style. `removeItem("lesson-session")` is the same bug in a different
// dialect, and nothing in this repo enforces single quotes. The quotes stay in the pattern
// so the `lesson-session.js` FILENAME (a real script tag in index.html and a real entry in
// perf/step.html's file list) is not mistaken for the key.
//
// Comments are stripped so the ones above can go on naming the key.
{
  const root = path.join(__dirname, '..');
  const NAMES_KEY = /["'`]lesson-session["'`]/;
  const stripComments = src => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  const withExt = (dir, ext) => fs.readdirSync(path.join(root, dir))
    .filter(f => f.endsWith(ext))
    .map(f => path.join(root, dir, f));
  const files = [
    ...withExt('js', '.js'), ...withExt('perf', '.js'),
    ...withExt('.', '.html'), ...withExt('perf', '.html'),
  ];

  const namers = files
    .filter(f => NAMES_KEY.test(stripComments(fs.readFileSync(f, 'utf8'))))
    .map(f => path.relative(root, f));

  check(`only js/quiz.js names '${KEY}' (${files.length} files scanned)`,
    namers.length === 1 && namers[0] === path.join('js', 'quiz.js'),
    namers.join(', ') || 'nobody names it — the adapter itself is gone?');
}

console.log('');
if (failures.length === 0) { console.log('✅ ALL PASSED'); process.exit(0); }
else { console.log(`❌ ${failures.length} FAILURE(S)`); process.exit(1); }
