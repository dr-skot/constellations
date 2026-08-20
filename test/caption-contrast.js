#!/usr/bin/env node
// The reveal caption's contrast, and its link's distinctness (issue #65).
//
// The caption is the richest teaching surface in the app and it was the dimmest thing
// on the screen: --dim (#5a6480) on --bg measures 3.43:1, where WCAG AA 1.4.3 wants
// 4.5:1 for normal text. The link inside it was the same colour and the same size as
// the prose, identified by its underline alone.
//
// This reads the stylesheets rather than a browser, which is the point: the numbers
// below are a property of the declared colours, so a future edit that dims them again
// fails here instead of in the field. The ratios were also confirmed against the
// rendered page (the ticket asks for computed values, not stylesheet values) — see the
// commit message.
//
// Contrast is measured against --bg because every caption sits on the app background:
// the reveal's picture is above it, not behind it.

const fs = require('fs');
const path = require('path');

const cssDir = path.join(__dirname, '..', 'css');
const read = f => fs.readFileSync(path.join(cssDir, f), 'utf8');

const failures = [];
const check = (name, ok, detail) => ok ? console.log(`OK: ${name}`)
  : (failures.push(name), console.log(`FAIL: ${name}` + (detail ? ` — ${detail}` : '')));

// ---- WCAG 2.x relative luminance and contrast ------------------------------
function rgbOf(hex) {
  let n = hex.replace('#', '').trim();
  if (n.length === 3) n = n.split('').map(c => c + c).join('');
  return [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16));
}
function luminance(hex) {
  const [r, g, b] = rgbOf(hex).map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(fg, bg) {
  const a = luminance(fg), b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

// Sanity-check the maths against two values WCAG's own examples fix, so a wrong
// ratio below is a wrong colour and not a wrong formula.
check('white on black is 21:1', Math.abs(contrast('#ffffff', '#000000') - 21) < 0.01);
check('a colour against itself is 1:1', Math.abs(contrast('#5a6480', '#5a6480') - 1) < 0.01);

// ---- The tokens -------------------------------------------------------------
const base = read('base.css');
const token = name => {
  const m = base.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`));
  return m && m[1];
};
const BG = token('bg');
const CAPTION = token('caption');
const ACCENT = token('accent');

check('base.css declares a --caption token', !!CAPTION, String(CAPTION));
check('base.css declares --bg', !!BG, String(BG));

const AA = 4.5;
if (CAPTION && BG) {
  const r = contrast(CAPTION, BG);
  check(`--caption clears WCAG AA on --bg (${r.toFixed(2)}:1)`, r >= AA, `${CAPTION} on ${BG}`);
}
if (ACCENT && BG) {
  const r = contrast(ACCENT, BG);
  check(`--accent clears WCAG AA on --bg (${r.toFixed(2)}:1)`, r >= AA, `${ACCENT} on ${BG}`);
}

// ---- The link is not identified by underline alone --------------------------
check('the caption link colour differs from the caption colour',
  CAPTION && ACCENT && CAPTION.toLowerCase() !== ACCENT.toLowerCase(), `${CAPTION} vs ${ACCENT}`);

// ---- Every caption surface uses the token -----------------------------------
// Three surfaces show a reveal caption: the identify question and the level-check probe
// share #feedback, the find question has #eq-feedback, and the constellation viewer has
// #view-caption. All three were on --dim; all three have to move together, or the level
// check keeps the unreadable one.
const SURFACES = [
  { file: 'quiz.css',   sel: '#feedback',     what: 'identify + level-check caption' },
  { file: 'explore.css', sel: '#eq-feedback', what: 'find caption' },
  { file: 'course.css', sel: '#view-caption', what: 'viewer caption' },
];
for (const { file, sel, what } of SURFACES) {
  const css = read(file);
  const rule = css.match(new RegExp(`\\${sel}\\s*\\{[^}]*\\}`));
  check(`${what}: rule found in ${file}`, !!rule, sel);
  if (!rule) continue;
  check(`${what}: uses var(--caption)`, rule[0].includes('var(--caption)'), rule[0].replace(/\s+/g, ' '));
  check(`${what}: no longer uses var(--dim)`, !rule[0].includes('var(--dim)'), rule[0].replace(/\s+/g, ' '));

  const linkRule = css.match(new RegExp(`\\${sel} a\\s*\\{[^}]*\\}`));
  check(`${what}: link rule found`, !!linkRule, `${sel} a`);
  if (!linkRule) continue;
  check(`${what}: link does not inherit the caption colour`,
    !/color:\s*inherit/.test(linkRule[0]), linkRule[0].replace(/\s+/g, ' '));
}

// ---- The find caption's answer colours are captions too ---------------------
// #eq-feedback is recoloured green or red the moment it is answered, which overrides
// the token above. Those two are the colours a learner actually reads on a find reveal,
// so they carry the same bar.
{
  const css = read('explore.css');
  for (const state of ['correct', 'wrong']) {
    const m = css.match(new RegExp(`#eq-feedback\\.${state}\\s*\\{[^}]*color:\\s*(#[0-9a-fA-F]{3,8})`));
    check(`the find caption's ${state} colour is declared`, !!m, String(m));
    if (m && BG) {
      const r = contrast(m[1], BG);
      check(`the find caption's ${state} colour clears WCAG AA (${r.toFixed(2)}:1)`,
        r >= AA, `${m[1]} on ${BG}`);
    }
  }
}

console.log('');
if (failures.length === 0) { console.log('✅ ALL PASSED'); process.exit(0); }
else { console.log(`❌ ${failures.length} FAILURE(S)`); process.exit(1); }
