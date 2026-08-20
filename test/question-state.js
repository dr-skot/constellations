#!/usr/bin/env node
// A lesson question has one state, and it is a three-state machine (issue #77).
//
//   unasked ──ask──▶ asked ──answer──▶ answered
//
// The code used to model two states across three flags — session.answered (written by
// the identify path only, and stale during a find question because it is assigned below
// the find early-return), session.history[idx] (which conflates "never shown" with
// "shown, not answered"), and explore.quiz.answered (the find path only). Nothing broke
// only because the stale flag's readers were identify-screen paths that are not visible
// during a find question. That was luck, not design.
//
// The missing state is `asked`. recordSeen belongs on the transition INTO it — it is the
// record that the question was PUT TO the learner — and with no transition to hang it on
// it was written as a guard on a state instead: "no answer recorded yet", which is true
// on every re-render of an unanswered question. So a reload mid-question, or Previous
// back onto one, recorded a second exposure and inflated `seen` without touching
// `correct`, cooling that constellation early in the review queue.

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

const newQuestion = () => ({ con: { abbr: 'Ori' }, type: 'identify', mode: 'diagram' });

// ── 1. A fresh question has not been asked ───────────────────────────────────
{
  const q = newQuestion();
  check('a question with no state reads as unasked', questionState(q) === QUESTION_UNASKED,
    questionState(q));
  check('and is not answered', !questionIsAnswered(q));
}

// ── 2. Asking is a transition, and it happens once ───────────────────────────
// This is the whole bug: the return value is what the caller gates recordSeen on, so a
// second ask cannot record a second exposure.
{
  const q = newQuestion();
  check('the first ask transitions', askQuestion(q) === true);
  check('and leaves the question asked', questionState(q) === QUESTION_ASKED, questionState(q));
  check('a second ask does NOT transition', askQuestion(q) === false);
  check('a third ask does not either', askQuestion(q) === false);
  check('and the state is unchanged', questionState(q) === QUESTION_ASKED, questionState(q));
}

// ── 2b. A question restored from storage says "unasked" out loud ─────────────
// questionFromJSON writes the state explicitly, so a resumed question carries the STRING
// 'unasked' where a freshly-planned one carries nothing at all. Both mean the same thing
// and must behave the same way. Checking `q.state` for truthiness instead of comparing it
// got this wrong in the first draft: every question in a resumed lesson refused to
// transition, so recordSeen never fired again for the rest of that lesson — an
// under-count, which is worse than the over-count #77 set out to fix. Caught in a
// browser, not here, which is why the case is now here.
{
  const q = { ...newQuestion(), state: QUESTION_UNASKED };
  check('an explicitly-unasked question reads unasked', questionState(q) === QUESTION_UNASKED);
  check('and it can still be asked', askQuestion(q) === true);
  check('and lands asked', questionState(q) === QUESTION_ASKED, questionState(q));
  check('and will not transition twice', askQuestion(q) === false);
}

// ── 3. Answering, and what it does not undo ──────────────────────────────────
{
  const q = newQuestion();
  askQuestion(q);
  answerQuestion(q);
  check('answering moves to answered', questionState(q) === QUESTION_ANSWERED, questionState(q));
  check('and reads as answered', questionIsAnswered(q) === true);
  // Re-showing an ANSWERED question — what returning from a finding guide does, and what
  // Previous does — must not re-open it or re-record anything.
  check('asking an answered question does not transition', askQuestion(q) === false);
  check('and does not drag it back to asked', questionState(q) === QUESTION_ANSWERED,
    questionState(q));
}

// ── 4. The states are ordered, and only forwards ─────────────────────────────
{
  const q = newQuestion();
  answerQuestion(q);           // a find question can be answered without a separate ask
  check('answering from unasked still lands answered', questionState(q) === QUESTION_ANSWERED,
    questionState(q));
  check('and cannot be re-opened by asking', askQuestion(q) === false);
}

// ── 5. The session-level query asks the current question ─────────────────────
// session.answered is gone; its readers ask the question on display. The stale-value
// hazard it carried cannot recur, because there is no second copy to leave behind.
{
  const a = newQuestion(), b = newQuestion();
  const session = { questions: [a, b], idx: 0 };
  check('an unanswered current question reads unanswered', sessionAnswered(session) === false);
  answerQuestion(a);
  check('answering the current question shows through', sessionAnswered(session) === true);
  session.idx = 1;
  check('moving to the next question reads unanswered again',
    sessionAnswered(session) === false);
  check('and the previous one is still answered', questionIsAnswered(a) === true);
  session.idx = 9;
  check('an index past the end is not answered', sessionAnswered(session) === false);
  check('an empty session is not answered', sessionAnswered({ questions: [], idx: 0 }) === false);
}

console.log('');
if (failures.length === 0) { console.log('✅ ALL PASSED'); process.exit(0); }
else { console.log(`❌ ${failures.length} FAILURE(S)`); process.exit(1); }
