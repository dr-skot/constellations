#!/usr/bin/env node
// Unit test for popoverPosition (js/render.js): the pure placement geometry for the
// course-screen card-anchored detail popover (issue #22). Given the tapped card's
// box, the measured popover size, and the container/viewport bounds, it decides
// side (below default, flip above on viewport-bottom overflow), a horizontally
// clamped left, and the arrow offset that keeps the arrow pointing at the card.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const origLog = console.log; console.log = () => {};
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'render.js'), 'utf8'), { filename: 'render.js' });
console.log = origLog;

const failures = [];
const check = (name, ok, detail) => ok ? origLog(`OK: ${name}`)
  : (failures.push(name), origLog(`FAIL: ${name}` + (detail ? ` — ${detail}` : '')));

// A card with plenty of room below opens below, arrow tracks its centre.
{
  const r = popoverPosition(
    { left: 100, top: 200, width: 145, height: 44, vBottom: 300 },
    { width: 320, height: 180 },
    { containerWidth: 600, viewportHeight: 800 });
  check('room below → opens below', r.above === false, JSON.stringify(r));
  check('below: top = card.top + height + gap', r.top === 252, `top=${r.top}`);
  check('left unclamped when it fits', r.left === 100, `left=${r.left}`);
  check('arrow points at card centre', r.arrow === 66.5, `arrow=${r.arrow}`);
}

// A card near the viewport bottom flips above; arrow moves with it.
{
  const r = popoverPosition(
    { left: 100, top: 200, width: 145, height: 44, vBottom: 700 },
    { width: 320, height: 180 },
    { containerWidth: 600, viewportHeight: 760 });
  check('overflow below → flips above', r.above === true, JSON.stringify(r));
  check('above: top = card.top - popHeight - gap', r.top === 12, `top=${r.top}`);
}

// Flip clamps to minTop when the card sits near the top of the container.
{
  const r = popoverPosition(
    { left: 100, top: 10, width: 145, height: 44, vBottom: 740 },
    { width: 320, height: 180 },
    { containerWidth: 600, viewportHeight: 760 });
  check('above: top clamped to minTop', r.above === true && r.top === 4, `top=${r.top}`);
}

// A card near the right edge: left clamps so the popover stays on-screen; the arrow
// clamps to the popover's inner range but still leans toward the card.
{
  const r = popoverPosition(
    { left: 550, top: 200, width: 145, height: 44, vBottom: 300 },
    { width: 320, height: 180 },
    { containerWidth: 600, viewportHeight: 800 });
  check('right edge: left clamped to containerWidth - popWidth', r.left === 280, `left=${r.left}`);
  check('right edge: arrow clamped to popWidth - pad', r.arrow === 296, `arrow=${r.arrow}`);
}

// Popover wider than the container: left never goes negative.
{
  const r = popoverPosition(
    { left: 100, top: 200, width: 145, height: 44, vBottom: 300 },
    { width: 320, height: 180 },
    { containerWidth: 300, viewportHeight: 800 });
  check('narrow container: left never negative', r.left === 0, `left=${r.left}`);
}

// A card at the far left: the arrow clamps to its minimum rather than going negative.
{
  const r = popoverPosition(
    { left: 0, top: 200, width: 10, height: 44, vBottom: 300 },
    { width: 320, height: 180 },
    { containerWidth: 600, viewportHeight: 800 });
  check('far left: arrow clamped to minArrow', r.arrow === 12, `arrow=${r.arrow}`);
}

origLog('');
if (failures.length === 0) { origLog('✅ ALL PASSED'); process.exit(0); }
else { origLog(`❌ ${failures.length} FAILURE(S)`); process.exit(1); }
