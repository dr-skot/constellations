#!/usr/bin/env node
// What the quiz header reports, for a lesson and for a level check (issue #67).
//
// The level check runs on the real quiz screen with a session.calibration flag rather
// than a replica — the right call, and it stays. But it inherited the running score,
// and a score is wrong here: a level check works by climbing PAST the point where you
// stop being right, so computeDStar can find the band where misses start outnumbering
// hits. Getting later probes wrong is the measurement working. The header said
// "0 correct" while the system did exactly what it was designed to do, one screen after
// the offer promised to place the learner rather than grade them.
//
// The difference is a parameter, not a fork: one function answers for both, so a future
// change to the wording cannot apply to only one of them.

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

// ── 1. A lesson still reports its score, unchanged ───────────────────────────
{
  check('a fresh lesson reads zero',
    quizScoreReadout({ correct: 0, calibration: false }) === '0 correct',
    quizScoreReadout({ correct: 0, calibration: false }));
  check('a lesson in progress counts up',
    quizScoreReadout({ correct: 7, calibration: false }) === '7 correct',
    quizScoreReadout({ correct: 7, calibration: false }));
}

// ── 2. A level check reports no count at all ─────────────────────────────────
// The acceptance criterion is the absence of a running correct-count, so this asserts
// the absence of the digits rather than one exact wording.
{
  for (const correct of [0, 1, 5]) {
    const out = quizScoreReadout({ correct, calibration: true });
    check(`a probe with ${correct} right shows no count`, !/\d/.test(out), out);
    check(`a probe with ${correct} right does not say "correct"`,
      !/correct/i.test(out), out);
  }
}

// ── 3. It says what is happening instead ─────────────────────────────────────
// An empty slot would also satisfy the criterion above, but the error path this ticket
// removes is a learner abandoning the check because it looks like failure. Naming the
// activity is what makes the screen agree with the offer that preceded it.
{
  const out = quizScoreReadout({ correct: 0, calibration: true });
  check('the probe header names the activity', out.trim().length > 0, JSON.stringify(out));
  check('and reads as placement, not scoring', /level/i.test(out), out);
}

// ── 4. One function, both flows ──────────────────────────────────────────────
{
  check('the lesson and probe readouts genuinely differ',
    quizScoreReadout({ correct: 3, calibration: false }) !==
    quizScoreReadout({ correct: 3, calibration: true }));
  check('the count comes from the session, not a global',
    quizScoreReadout({ correct: 11, calibration: false }) === '11 correct');
}

console.log('');
if (failures.length === 0) { console.log('✅ ALL PASSED'); process.exit(0); }
else { console.log(`❌ ${failures.length} FAILURE(S)`); process.exit(1); }
