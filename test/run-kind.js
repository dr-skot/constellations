#!/usr/bin/env node
// A session is one RUN, and it says which one (issue #92).
//
//   none ─────▶ lesson
//        └────▶ level check
//
// The fact used to be spelled three ways across six files, and two of those spellings were
// the same fact split over two fields that every writer had to set consistently:
//
//   session.calibration === true        "this is a level check"   (9 sites)
//   session.lessonIdx == null           "this is NOT a lesson"    (6 sites)
//   explore.quiz.lessonMode             "this find question is a lesson's" (8 sites)
//
// calBegin wrote `calibration = true` AND `lessonIdx = null`; startLesson wrote
// `lessonIdx = 0` AND `calibration = false`. Nothing enforced the pairing, and setting one
// without the other produced a session that was a lesson and a level check at once — which
// fails silently and expensively: a level check that records exposures writes over the
// learner's record before D* has measured them, and a lesson that does not persist loses
// itself on reload.
//
// One field makes that state unrepresentable rather than merely unwritten. The third
// spelling is gone entirely, because the explorer's practice quiz it distinguished against
// was dead code and was deleted; explore.quiz now means "a lesson's find question is on
// display" and nothing else.
//
// Note `lessonIdx` was never an index: read twice, both times as `== null`, written three
// times, always 0 or null. A boolean wearing an index's name.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const origLog = console.log; console.log = () => {};
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'quiz.js'), 'utf8'),
                    { filename: 'quiz.js' });
console.log = origLog;

const failures = [];
const check = (name, ok, detail) => ok ? console.log(`OK: ${name}`)
  : (failures.push(name), console.log(`FAIL: ${name}` + (detail ? ` — ${detail}` : '')));

const ALL = [RUN_NONE, RUN_LESSON, RUN_LEVEL_CHECK];

// ── 1. The three values are distinct ─────────────────────────────────────────
{
  check('the three run kinds are distinct', new Set(ALL).size === 3, ALL.join(','));
}

// ── 2. A session that has not started a run is in none ───────────────────────
// The default matters because it is what a freshly-loaded page has, and because a session
// restored from storage carries no run of its own — tryResumeLesson sets it.
{
  check('a session with no run reads as none', runKind({}) === RUN_NONE, runKind({}));
  check('and is not a lesson', isLesson({}) === false);
  check('and is not a level check', isLevelCheck({}) === false);
  check('an undefined session reads as none', runKind(undefined) === RUN_NONE);
  check('and answers both predicates false',
    isLesson(undefined) === false && isLevelCheck(undefined) === false);
}

// ── 3. Each value answers exactly one predicate ──────────────────────────────
// This is the property the two-field encoding could not offer: the states are mutually
// exclusive BY CONSTRUCTION, not by every writer remembering to clear the other field.
{
  const lesson = { run: RUN_LESSON };
  check('a lesson is a lesson', isLesson(lesson) === true);
  check('and is not a level check', isLevelCheck(lesson) === false);

  const levelCheck = { run: RUN_LEVEL_CHECK };
  check('a level check is a level check', isLevelCheck(levelCheck) === true);
  check('and is not a lesson', isLesson(levelCheck) === false);

  const none = { run: RUN_NONE };
  check('none is neither', isLesson(none) === false && isLevelCheck(none) === false);

  for (const run of ALL) {
    const both = isLesson({ run }) && isLevelCheck({ run });
    check(`${run} is never both at once`, both === false);
  }
}

// ── 4. An unrecognized value is not a run ────────────────────────────────────
// Defensive rather than reachable: nothing writes anything else. But the predicates are
// what the app branches on, and "unknown" must fall to the safe side of every branch —
// no exposure recording, no persistence — rather than to whichever one tests truthiness.
{
  check('an unknown run is not a lesson', isLesson({ run: 'practice' }) === false);
  check('an unknown run is not a level check', isLevelCheck({ run: 'practice' }) === false);
}

// ── 5. The score readout asks the run, not a boolean ─────────────────────────
// quizScoreReadout reads its argument by DESTRUCTURING, which is why a grep for
// `session.calibration` missed it in the original census. Its wording is #67's and must
// not move: a level check climbs past the point where the learner stops being right, so a
// running score reads as failure when it is the measurement working.
{
  check('a level check hides the score',
    quizScoreReadout({ correct: 3, run: RUN_LEVEL_CHECK }) === 'Finding your level…',
    quizScoreReadout({ correct: 3, run: RUN_LEVEL_CHECK }));
  check('a lesson shows it',
    quizScoreReadout({ correct: 3, run: RUN_LESSON }) === '3 correct',
    quizScoreReadout({ correct: 3, run: RUN_LESSON }));
  check('and so does a session with no run',
    quizScoreReadout({ correct: 0, run: RUN_NONE }) === '0 correct',
    quizScoreReadout({ correct: 0, run: RUN_NONE }));
}

// ── 6. The retired spellings are gone from the code ──────────────────────────
// A sweep, not a grep in a commit message: these names are exactly the ones a later change
// would reach for by habit, and each reintroduces a second place to ask the same question.
//
// It scans CODE, not prose — comments here deliberately still name `lessonMode` and
// startExploreQuiz to record what was removed and why, and a guard that could not tell
// those apart would either fail on its own documentation or be silenced by deleting it.
//
// PROVEN TO FAIL before being believed, per the rule this repo adopted after #82: each of
// the six names below was pasted back into js/quiz.js in turn and this check went red for
// it. That matters because the last two guards added here looked like guards and were not
// — one reduced to `u === u`, the other had a remedy that was a no-op.
{
  const stripComments = src => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // `[^:]` guards the `//` in a URL inside a string literal; dropping a trailing comment
    // can only hide an occurrence, never invent one, so this errs toward a quiet pass and
    // is why the sabotage run above is the thing that gives this check its authority.
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  const RETIRED = [
    ['startExploreQuiz',    'the dead practice quiz'],
    ['nextExploreQuestion', 'the dead practice quiz'],
    ['.lessonMode',         'the third spelling of the run'],
    ['.lessonIdx',          'a boolean wearing an index\'s name'],
    ['session.calibration', 'the second spelling of the run'],
    ['eq-score',            'the practice quiz\'s running score'],
  ];

  // SCOPE IS HALF THE GUARD. The first version of this swept js/*.js and index.html and
  // nothing else, which let `session.lessonIdx` and `session.calibration` survive in
  // perf/app-probe.js — a live writer of the shared `session`, missed by the census for
  // the same reason and then waved through by the very check meant to catch it.
  //
  // That is the third time in this repo a guard has fired correctly while looking in the
  // wrong place (#82's two were the others). Proving a sweep goes red for a name says
  // nothing about WHERE it looked; both have to be checked. The scanned set matches
  // test/cache-stamp.js's convention — every page, plus every script a page loads.
  const root = path.join(__dirname, '..');
  const withExt = (dir, ext) => fs.readdirSync(path.join(root, dir))
    .filter(f => f.endsWith(ext))
    .map(f => path.join(root, dir, f));
  const files = [
    ...withExt('js', '.js'), ...withExt('perf', '.js'),
    ...withExt('.', '.html'), ...withExt('perf', '.html'),
  ];

  for (const [name, why] of RETIRED) {
    const hits = files
      .filter(f => stripComments(fs.readFileSync(f, 'utf8')).includes(name))
      .map(f => path.relative(root, f));
    check(`\`${name}\` appears in no code — ${why}`, hits.length === 0, hits.join(', '));
  }
}

console.log('');
if (failures.length === 0) { console.log('✅ ALL PASSED'); process.exit(0); }
else { console.log(`❌ ${failures.length} FAILURE(S)`); process.exit(1); }
