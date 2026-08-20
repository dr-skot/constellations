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

// SECOND CHECK, added 2026-08-20: every runtime fetch() goes through stampedUrl().
// bump-stamp.js finds versioned files by scanning the HTML for src=/href=, so a file
// fetched from JavaScript is outside the fence entirely — no ?v=, no busting, and an
// iOS client keeps the old copy. Three were sitting there unnoticed
// (constellation-blurbs, finding-guides, sky-objects), found only because a rewrite of
// the blurbs would not have reached anyone. The stamp being current says nothing about
// this, which is why it needs its own assertion rather than trust.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const tool = path.join(root, 'tools', 'bump-stamp.js');

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

// A fetch of a same-origin path, not wrapped in stampedUrl(). Absolute URLs are left
// alone: a third-party host has its own caching and no stamp of ours to carry.
const BARE_FETCH = /fetch\(\s*(['"])(?!https?:|\/\/)([^'"]+)\1/g;
const offenders = [];
for (const name of fs.readdirSync(path.join(root, 'js')).sort()) {
  if (!name.endsWith('.js')) continue;
  const src = fs.readFileSync(path.join(root, 'js', name), 'utf8');
  let m;
  BARE_FETCH.lastIndex = 0;
  while ((m = BARE_FETCH.exec(src))) offenders.push(`js/${name}: fetch('${m[2]}')`);
}

if (offenders.length) {
  ok = false;
  console.log('');
  console.log('Runtime fetch without a cache stamp — wrap the path in stampedUrl():');
  for (const o of offenders) console.log(`  ${o}`);
}

console.log('');
if (ok) { console.log('✅ ALL PASSED'); process.exit(0); }
console.log(`❌ ${offenders.length ? offenders.length : 1} FAILURE(S)`);
process.exit(1);
