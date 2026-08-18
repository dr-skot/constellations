#!/usr/bin/env node
// The 88 authored blurbs must not tell a learner what SEASON or what part of THEIR sky
// to look in (issue #62). The finding-guide editorial pass settled this rule for the
// guides — "no hemisphere/seasonal references, 'southern constellation' OK for genuinely
// far-south objects" — and the blurbs are the other body of prose the learner reads.
//
// Seasons are hemisphere-flipped, so "rides overhead on winter nights" is wrong for half
// the planet, and worse than wrong for a far-south constellation: Grus at dec -44 is high
// and it is spring, not low and autumn.
//
// This does NOT police the word "southern" itself. Fourteen blurbs use it for
// constellations below dec -30, which the rule permits and which is simply true. The
// aggregate asymmetry — southern constellations being told what they are six times as
// often as northern ones — is reported at the bottom as context, not asserted: "the
// counts should be closer" is a judgement, not a threshold, and a test that pretends
// otherwise would just get its number tuned until it passed.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const blurbs = JSON.parse(fs.readFileSync(path.join(root, 'js/constellation-blurbs.json'), 'utf8'));
const sandbox = {};
vm.runInNewContext(fs.readFileSync(path.join(root, 'js/data.js'), 'utf8') + ';this.C=C;', sandbox);
const dec = {};
for (const c of sandbox.C) dec[c.abbr] = c.dec;

const failures = [];
const check = (name, ok, detail) => ok ? console.log(`OK: ${name}`)
  : (failures.push(name), console.log(`FAIL: ${name}` + (detail ? ` — ${detail}` : '')));

// Seasonal framing of when or where to LOOK. Deliberately narrow — it does not match
// "the Sun crossed into Aries at the start of spring", which dates an equinox rather
// than directing an observer.
const SEASON_LOOK = /(winter|summer|autumn|spring)\s+(sky|skies|nights?|evenings?)|(sky|skies|nights?|evenings?)\s+(of|in)\s+(winter|summer|autumn|spring)/i;

// Asterism proper nouns. These are the NAMES of the things, not claims about when to
// look, and they are excluded before matching rather than allowlisted after — otherwise
// Aquila and Monoceros would show up as violations they are not committing.
const ASTERISM = /(Winter|Summer)\s+Triangle/g;

// Known violations, tracked by #62. This list must only ever SHRINK; #62 is done when it
// is empty. It exists so the rule can be enforced against new prose today rather than
// waiting for the fix — a test that cannot land until the bug is fixed guards nothing in
// the meantime.
const KNOWN = new Set(['Aur', 'Peg', 'CMa', 'Gru']);

const hits = [];
for (const [abbr, text] of Object.entries(blurbs)) {
  const m = text.replace(ASTERISM, '').match(SEASON_LOOK);
  if (m) hits.push({ abbr, phrase: m[0].trim(), dec: dec[abbr] });
}

const fresh = hits.filter(h => !KNOWN.has(h.abbr));
const fixed = [...KNOWN].filter(a => !hits.some(h => h.abbr === a));

check('no NEW blurb frames when or where to look by season',
  fresh.length === 0,
  fresh.map(h => `${h.abbr} (dec ${Math.round(h.dec)}): "${h.phrase}"`).join('; '));

check('the known-violation list has not gone stale',
  fixed.length === 0,
  fixed.length ? `${fixed.join(', ')} no longer offend — remove them from KNOWN` : '');

check('every blurb has text', Object.values(blurbs).every(t => typeof t === 'string' && t.length > 40));
check('there is one blurb per constellation', Object.keys(blurbs).length === sandbox.C.length,
  `${Object.keys(blurbs).length} blurbs vs ${sandbox.C.length} constellations`);

if (hits.length) {
  console.log('');
  console.log(`   ${hits.length} known seasonal violation(s) outstanding (#62):`);
  for (const h of hits) console.log(`     ${h.abbr.padEnd(4)} dec ${String(Math.round(h.dec)).padStart(4)}  "${h.phrase}"`);
}

// ── Context, not assertions ───────────────────────────────────────────────────
{
  const isN = a => dec[a] >= 0;
  let nN = 0, sS = 0, nTotal = 0, sTotal = 0;
  for (const [abbr, text] of Object.entries(blurbs)) {
    if (isN(abbr)) { nTotal++; if (/\bnorthern\b/i.test(text)) nN++; }
    else           { sTotal++; if (/\bsouthern\b/i.test(text)) sS++; }
  }
  console.log('');
  console.log('   hemisphere naming (reported, not asserted — see #62):');
  console.log(`     a northern blurb says "northern": ${nN}/${nTotal}`);
  console.log(`     a southern blurb says "southern": ${sS}/${sTotal}`);
}

console.log('');
if (failures.length === 0) { console.log('✅ ALL PASSED'); process.exit(0); }
else { console.log(`❌ ${failures.length} FAILURE(S)`); process.exit(1); }
