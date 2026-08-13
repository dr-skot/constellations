#!/usr/bin/env node
// Characterization capture for makeStepDisplay (issue #38, spec #37).
//
// Runs the constructor over every step in the real guide data and freezes the result as
// test/step-display-golden.json. test/step-display.js replays it and asserts equality,
// so a change in normalization — or a change in the guide data — shows up as a diff.
//
// Unlike test/capture-display-flags-golden.js there is no pre-refactor oracle to capture
// from: this value did not exist before. So this golden is a REGRESSION freeze, not a
// correctness proof. Correctness comes from the oracle-backed cases in
// test/step-display.js, which compare against verbatim transcriptions of the old code.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const jsDir = path.join(__dirname, '..', 'js');
vm.runInThisContext(fs.readFileSync(path.join(jsDir, 'step-display.js'), 'utf8'), { filename: 'step-display.js' });

const guides  = JSON.parse(fs.readFileSync(path.join(jsDir, 'finding-guides.json'), 'utf8'));
const catalog = JSON.parse(fs.readFileSync(path.join(jsDir, 'sky-objects.json'), 'utf8'));

const golden = [];
const problems = [];
for (const [name, guide] of Object.entries(guides)) {
  (guide.steps || []).forEach((step, i) => {
    const display = makeStepDisplay(step, catalog);
    golden.push({ label: `${name}#${i}`, display });
    for (const p of display.problems) problems.push(`${name}#${i} — ${p}`);
  });
}

const out = path.join(__dirname, 'step-display-golden.json');
fs.writeFileSync(out, JSON.stringify(golden, null, 2) + '\n');
console.log(`Captured ${golden.length} steps -> ${path.relative(process.cwd(), out)}`);
if (problems.length) {
  console.log(`\n${problems.length} PROBLEM(S) in the guide data:`);
  for (const p of problems) console.log(`  ${p}`);
}
