#!/usr/bin/env node
// Rewrite the ?v= cache stamp across every HTML entry point.
//
// The stamp is the content hash of the scripts it versions. That is the whole idea:
// change any of them and the stamp changes, so every script URL changes, so no browser
// can pair a fresh index.html with a cached js/quiz.js. The failure that costs a real
// learner — new HTML calling into old JS, throwing deep inside an interaction — stops
// being a thing we have to remember not to cause.
//
// What we DO have to remember is running this. That part is checked:
// test/cache-stamp.js recomputes the hash and fails when the tree has moved on without
// it, naming the files that changed. Forgetting is loud, at a moment when it is free to
// fix, rather than silent until an iOS Safari client reloads.
//
// Not a build step. It edits source in place and you commit the result; the served files
// stay plain checked-in HTML with no pipeline behind them.
//
// Usage: node tools/bump-stamp.js  [--check]
//   --check exits non-zero and prints the diagnosis instead of writing (what the test
//   uses, so the two can never disagree about what "stale" means).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');

// Every HTML file that stamps something. Found rather than listed, so a page added later
// is covered without anyone remembering this file exists.
function entryPoints() {
  const pages = [];
  for (const dir of ['.', 'perf']) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs)) {
      if (!name.endsWith('.html')) continue;
      const rel = path.join(dir, name).replace(/^\.\//, '');
      if (fs.readFileSync(path.join(root, rel), 'utf8').includes('?v=')) pages.push(rel);
    }
  }
  return pages.sort();
}

const STAMPED = /(?:src|href)="([^"?]+)\?v=([^"]*)"/g;

// Which files are versioned, and what stamp each page currently carries.
function survey(pages) {
  const files = new Set();
  const stamps = {};
  for (const page of pages) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    const seen = new Set();
    let m;
    STAMPED.lastIndex = 0;
    while ((m = STAMPED.exec(html))) {
      const target = path.join(path.dirname(page), m[1]).replace(/^\.\//, '');
      if (fs.existsSync(path.join(root, target))) files.add(target);
      seen.add(m[2]);
    }
    stamps[page] = [...seen];
  }
  return { files: [...files].sort(), stamps };
}

// Files fetched at RUNTIME through stampedUrl() (js/cache-stamp.js). These carry the
// stamp in their URL but are invisible to the HTML scan above, so without this they
// would be hashed by nobody: editing js/constellation-blurbs.json alone would leave the
// stamp unchanged, the URL identical, and the cached copy in place. The stamp has to
// cover what it versions or it is decoration.
//
// HTML pages are scanned too, not just js/ (#84). A stampedUrl() call in an inline
// <script> carries the stamp correctly but, if only js/ were scanned, its asset would be
// in nobody's hash — so editing that asset alone would leave the stamp unchanged and the
// URL identical, which is the very failure this function exists to prevent, one directory
// over. It has been latent rather than live only because js/find-guide.js happened to
// name the same two JSON files find-help.html fetches.
function fetchedAtRuntime(pages) {
  const found = new Set();
  const CALL = /stampedUrl\(\s*(['"])([^'"]+)\1/g;
  const sources = [];
  for (const name of fs.readdirSync(path.join(root, 'js'))) {
    if (name.endsWith('.js')) sources.push(`js/${name}`);
  }
  sources.push(...pages);
  for (const rel of sources) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    let m;
    CALL.lastIndex = 0;
    while ((m = CALL.exec(src))) {
      if (fs.existsSync(path.join(root, m[2]))) found.add(m[2]);
    }
  }
  return [...found];
}

// One hash over every versioned file. Paths are included so that moving code between
// files changes the stamp even when the bytes are merely rearranged.
function fingerprint(files) {
  const h = crypto.createHash('sha256');
  for (const f of files) {
    h.update(f);
    h.update('\0');
    h.update(fs.readFileSync(path.join(root, f)));
    h.update('\0');
  }
  return h.digest('hex').slice(0, 12);
}

const pages = entryPoints();
const { files: htmlFiles, stamps } = survey(pages);
const files = [...new Set([...htmlFiles, ...fetchedAtRuntime(pages)])].sort();
const want = fingerprint(files);

const wrong = pages.filter(p => stamps[p].length !== 1 || stamps[p][0] !== want);

if (process.argv.includes('--check')) {
  if (!wrong.length) {
    console.log(`cache stamp is current (${want}, over ${files.length} files)`);
    process.exit(0);
  }
  console.log(`The ?v= cache stamp is stale. Expected ${want}.`);
  for (const p of wrong) console.log(`  ${p} carries ${stamps[p].join(', ') || '(none)'}`);
  console.log('\nRun: node tools/bump-stamp.js');
  process.exit(1);
}

let touched = 0;
for (const page of pages) {
  const abs = path.join(root, page);
  const html = fs.readFileSync(abs, 'utf8');
  const next = html.replace(/((?:src|href)="[^"?]+\?v=)[^"]*"/g, `$1${want}"`);
  if (next !== html) { fs.writeFileSync(abs, next); touched++; }
}
console.log(`stamp ${want} over ${files.length} versioned files; ${touched} page(s) rewritten`);
