#!/usr/bin/env node
// The finding guide's exit label (issue #66).
//
// The control that leaves a guide used to read "← Back" whatever it went back to —
// on find-help.html, next to a second control reading exactly the same thing. The
// label is now a value: guideExitLabel says where leaving goes, from the detour in
// flight (if any) and whether a lesson's find question is waiting underneath.
//
// This is the pure half. That the button actually renders it is section 23 of
// test/explore-scheduler-wiring.js, which drives the real guide-renderer.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const jsDir = path.join(__dirname, '..', 'js');
vm.runInThisContext(fs.readFileSync(path.join(jsDir, 'guide-exit-label.js'), 'utf8'),
                    { filename: 'guide-exit-label.js' });

const failures = [];
const check = (name, ok, detail) => ok ? console.log(`OK: ${name}`)
  : (failures.push(name), console.log(`FAIL: ${name}` + (detail ? ` — ${detail}` : '')));

// ── 1. A detour names the route it returns to ────────────────────────────────
// The three routes that come back — the router's detours table: a lesson question, a
// level-check probe, the constellation viewer.
{
  check('a lesson question is named as the lesson',
    guideExitLabel({ route: 'lesson' }) === '← Back to lesson',
    guideExitLabel({ route: 'lesson' }));
  check('a level-check probe is named as the level check',
    guideExitLabel({ route: 'calibration' }) === '← Back to level check',
    guideExitLabel({ route: 'calibration' }));
  check('the viewer is named by the constellation it is showing',
    guideExitLabel({ route: 'view', conName: 'Orion' }) === '← Back to Orion',
    guideExitLabel({ route: 'view', conName: 'Orion' }));
}

// ── 2. The find question underneath, with no detour in flight ────────────────
// "? Help" on a lesson's find question opens the guide over the question rather than
// navigating away, so no detour is in flight — but the lesson is still what the exit
// returns to, and it must say so.
{
  check('a find question underneath is named as the lesson',
    guideExitLabel({ lessonFindQuestion: true }) === '← Back to lesson',
    guideExitLabel({ lessonFindQuestion: true }));
}

// ── 3. Free explore has nowhere to go back to ────────────────────────────────
// The learner is already looking at the explorer; the overlay is simply closing. No
// arrow, because nothing is being retraced.
{
  check('free explore closes rather than going back',
    guideExitLabel({}) === 'Close guide', guideExitLabel({}));
  check('called with nothing at all, it still closes',
    guideExitLabel() === 'Close guide', guideExitLabel());
}

// ── 4. No label is a bare "Back" ─────────────────────────────────────────────
// The bug itself: every label either names its destination or names the action.
{
  const all = [
    guideExitLabel({ route: 'lesson' }),
    guideExitLabel({ route: 'calibration' }),
    guideExitLabel({ route: 'view', conName: 'Triangulum Australe' }),
    guideExitLabel({ route: 'view' }),
    guideExitLabel({ lessonFindQuestion: true }),
    guideExitLabel({}),
  ];
  const bare = all.filter(s => s === '← Back' || s === 'Back');
  check('no case produces a bare Back', bare.length === 0, all.join(' | '));
  // A character count, standing in for the fit — the real check is pixels, and it was
  // made in a browser: the longest of these measures 187px in a 390px-wide app, and
  // css/explore.css pins #fg-back-btn nowrap and unshrinkable so it stays that way.
  // This one only catches a future label that grows past anything measured.
  check('no label outgrows the longest one measured on a phone',
    all.every(s => s.length <= 30), all.map(s => `${s}(${s.length})`).join(' | '));
}

// ── 5. A viewer detour whose constellation cannot be named ───────────────────
// Unreachable through the app — the router declines a detour to an unknown abbr — but
// the exit is still a return to the viewer, so it must not claim to be closing.
{
  check('an unnamed viewer detour still reads as going back',
    guideExitLabel({ route: 'view' }) === '← Back to the figure',
    guideExitLabel({ route: 'view' }));
}

console.log('');
if (failures.length === 0) { console.log('✅ ALL PASSED'); process.exit(0); }
else { console.log(`❌ ${failures.length} FAILURE(S)`); process.exit(1); }
