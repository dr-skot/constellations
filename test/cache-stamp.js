#!/usr/bin/env node
// The ?v= cache stamp is current.
//
// index.html and find-help.html load the same modules, and those modules call across
// each other. A visitor holding one cached and the other fresh gets a page that loads
// and then throws on the first interaction that crosses the seam — the failure the stamp
// exists to prevent, and which nothing noticed when four commits in a row changed six
// scripts and moved no stamp (that is what prompted this test).
//
// The stamp is the content hash of the files it versions (tools/bump-stamp.js), so when
// it is current the failure cannot happen: any change to a versioned file changes every
// script URL. This asserts that it IS current, which is the one thing a person has to
// remember and therefore the one thing worth checking.
//
// It also subsumes the consistency check of issue #61: a single expected value across
// every entry point means disagreement between two pages fails here too.

const { execFileSync } = require('child_process');
const path = require('path');

const tool = path.join(__dirname, '..', 'tools', 'bump-stamp.js');

// The tool's own --check is the oracle, so the test and the fix can never disagree about
// what "stale" means.
let out, ok = true;
try {
  out = execFileSync('node', [tool, '--check'], { encoding: 'utf8' });
} catch (e) {
  ok = false;
  out = (e.stdout || '') + (e.stderr || '');
}

console.log(out.trim());
console.log('');
if (ok) { console.log('✅ ALL PASSED'); process.exit(0); }
console.log('❌ 1 FAILURE(S)');
process.exit(1);
