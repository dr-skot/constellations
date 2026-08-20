#!/usr/bin/env node
// The reveal caption's constellation label and its link depth (issue #64).
//
// A quiz question is a question: its reveal may offer at most one step away, and which
// step is a property of the question type. That decision used to be unavailable —
// conLabel built the same anchor for every caller, so a level-check probe offered the
// same open-ended walk into the explorer as free browsing did. The mode now arrives as
// an argument, which is what makes it testable here rather than only in a browser.
//
// conLabel is pure (a constellation plus a mode in, a string out), so this file is the
// whole of the decision. Which caller passes which mode is DOM wiring, verified live.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const origLog = console.log; console.log = () => {};
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'render.js'), 'utf8'),
                    { filename: 'render.js' });
console.log = origLog;

const failures = [];
const check = (name, ok, detail) => ok ? console.log(`OK: ${name}`)
  : (failures.push(name), console.log(`FAIL: ${name}` + (detail ? ` — ${detail}` : '')));

const ORI = { abbr: 'Ori', name: 'Orion', hem: 'E', meaning: 'the hunter' };
const CNC = { abbr: 'Cnc', name: 'Cancer', hem: 'N', meaning: 'the crab' };
const BARE = { abbr: 'Xyz', name: 'Nomeaning', hem: 'S' };

// ── 1. The gloss is the same whatever the link does ──────────────────────────
// Only the link changes between modes. The sentence a learner reads — name, meaning,
// hemisphere — must not, or the modes become four different captions.
{
  const gloss = s => s.replace(/<[^>]*>/g, '');
  const modes = [undefined, false, 'blurb', 'guide', 'full'];
  const glosses = modes.map(link => gloss(conLabel(ORI, link === undefined ? undefined : { link })));
  check('every mode reads the same once the markup is stripped',
    new Set(glosses).size === 1, glosses.join(' | '));
  check('the gloss is name, meaning, hemisphere',
    glosses[0] === 'Orion, the hunter (equatorial)', glosses[0]);
}

// ── 2. link: false is genuinely plain ────────────────────────────────────────
// The level-check probe's case. A signifier pointing at nothing is its own bug, so
// this asserts the absence of the anchor itself, not merely of a working handler:
// no <a>, no class for the delegated click handler to match, no href to underline.
{
  const plain = conLabel(ORI, { link: false });
  check('no anchor element', !/<a[\s>]/i.test(plain), plain);
  check('no con-info-link class', !plain.includes('con-info-link'), plain);
  check('no href', !plain.includes('href'), plain);
  check('the name still reads', plain.startsWith('Orion'), plain);
}

// ── 3. Each linking mode is carried on the anchor ────────────────────────────
// The delegated handler reads this to decide blurb / guide / full, so the mode has to
// survive into the markup — it cannot be re-derived from the DOM later.
{
  for (const link of ['blurb', 'guide', 'full']) {
    const html = conLabel(ORI, { link });
    check(`${link}: anchor carries data-link="${link}"`,
      html.includes(`data-link="${link}"`), html);
    check(`${link}: anchor carries the abbr`, html.includes('data-abbr="Ori"'), html);
    check(`${link}: anchor is a con-info-link`, html.includes('class="con-info-link"'), html);
  }
}

// ── 4. The default is today's behaviour, not the most restricted ─────────────
// Deliberate deviation from the ticket, which names 'blurb' as the default: the viewer
// keeps the full modal and reaches it through this same function, so a default of
// 'blurb' would silently strip the viewer's actions. A new caller that says nothing
// gets what every caller got before this change.
{
  check('no options at all means the full modal',
    conLabel(ORI) === conLabel(ORI, { link: 'full' }), conLabel(ORI));
  check('an empty options object means the full modal',
    conLabel(ORI, {}) === conLabel(ORI, { link: 'full' }), conLabel(ORI, {}));
}

// ── 5. The gloss's own edge cases, unchanged by this ticket ──────────────────
{
  check('a constellation with no meaning omits the clause',
    conLabel(BARE, { link: false }) === 'Nomeaning (southern)', conLabel(BARE, { link: false }));
  check('northern reads northern',
    conLabel(CNC, { link: false }).endsWith('(northern)'), conLabel(CNC, { link: false }));
}

// ── 6. The wrong-answer caption names both roles ─────────────────────────────
// The bug this ticket carries: "✗ That was X" meant what you CLICKED when you hit a
// constellation and what you SHOULD HAVE clicked when you missed — one sentence, two
// opposite referents, and the link went to whichever it happened to name. Both find
// call sites (live answer, history re-render) build it here now, so they cannot drift.
{
  const wrongCon = findAnswerCaption({ target: ORI, clicked: CNC, correct: false, link: 'guide' });
  check('clicking the wrong constellation names both',
    wrongCon.includes('Cancer') && wrongCon.includes('Orion'), wrongCon);
  check('and links only the right one',
    wrongCon.includes('data-abbr="Ori"') && !wrongCon.includes('data-abbr="Cnc"'), wrongCon);
  check('and says "not" so the two roles are distinguishable',
    wrongCon.includes('not'), wrongCon);

  const wrongSky = findAnswerCaption({ target: ORI, clicked: null, correct: false, link: 'guide' });
  check('missing entirely does not use the same sentence',
    wrongSky !== wrongCon && !wrongSky.includes('Sorry'), wrongSky);
  check('and still names the right answer, linked',
    wrongSky.includes('data-abbr="Ori"'), wrongSky);

  const right = findAnswerCaption({ target: ORI, clicked: ORI, correct: true, link: 'guide' });
  check('a correct answer reads as correct', right.includes('✓'), right);
  check('a correct answer links the target', right.includes('data-abbr="Ori"'), right);

  // The level-check probe answers wrongly too, and gets no link in either sentence.
  const probe = findAnswerCaption({ target: ORI, clicked: CNC, correct: false, link: false });
  check('link:false leaves the wrong-answer caption linkless',
    !probe.includes('<a') && probe.includes('Cancer') && probe.includes('Orion'), probe);
}

console.log('');
if (failures.length === 0) { console.log('✅ ALL PASSED'); process.exit(0); }
else { console.log(`❌ ${failures.length} FAILURE(S)`); process.exit(1); }
