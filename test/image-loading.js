#!/usr/bin/env node
// One owner for artwork that arrives late (issue #93).
//
// ensureArtLoaded is the owner: it caches by art source, dedupes a load already in
// flight, and queues callers who ask mid-flight so they can be told when the image
// lands. Its own comment says what the queue is for — a second panel asking mid-flight
// "would otherwise be told nothing and paint without it — its Art toggle on, showing
// none."
//
// That is exactly what happened, because the explorer's WebGL layer did not use it. It
// started its own load for the same artwork, marked the shared cache as loading, and on
// arrival wrote the image in WITHOUT draining the queue. Anyone waiting behind it waited
// forever: artwork downloaded fine, panel never told, Art toggle on and nothing under it.
//
// Reproduced in Chrome before the fix, running both real code paths in their real order:
//   queuedWaiters: 1, artCacheNowAnImage: true, panelCallbackFired: false
//
// The queue is testable here at all because the image constructor is injected. It
// DEFAULTS to the real Image, deliberately unlike initGuideSource's required fetch: this
// module opens no connection merely by being loaded, and find-help.html is a second host
// that would have to remember the init — forgetting exactly that on that page is what
// #82's first bug was. A default the browser always gets right is safer here.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── A fake image whose load and error the test fires by hand ─────────────────
const made = [];
function FakeImage() {
  this.onload = null;
  this.onerror = null;
  this._src = null;
  made.push(this);
}
Object.defineProperty(FakeImage.prototype, 'src', {
  get() { return this._src; },
  set(v) { this._src = v; },          // assignment starts the "load"; nothing resolves it
});
FakeImage.prototype.land = function () { if (this.onload) this.onload(); };
FakeImage.prototype.fail = function () { if (this.onerror) this.onerror(); };

const origLog = console.log; console.log = () => {};
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'render.js'), 'utf8'),
                    { filename: 'render.js' });
console.log = origLog;

const failures = [];
const check = (name, ok, detail) => ok ? console.log(`OK: ${name}`)
  : (failures.push(name), console.log(`FAIL: ${name}` + (detail ? ` — ${detail}` : '')));

// Minimal art catalog: two constellations sharing one artwork source (Argo Navis is a
// real case — Puppis and Vela both display Carina's art), plus one with none.
global.ART = {
  Car: { url: 'img/art/Car.png', anchors: [{}, {}, {}] },
  Ori: { url: 'img/art/Ori.png', anchors: [{}, {}, {}] },
};
global.ART_ALIAS = { Vel: 'Car', Pup: 'Car' };
if (typeof artSrc !== 'function') {
  global.artSrc = abbr => (global.ART_ALIAS[abbr] || abbr);
}

const CAR = { abbr: 'Car' }, VEL = { abbr: 'Vel' }, ORI = { abbr: 'Ori' }, NONE = { abbr: 'Xyz' };

function reset() {
  for (const k of Object.keys(artCache)) delete artCache[k];
  for (const k of Object.keys(_artWaiting)) delete _artWaiting[k];
  made.length = 0;
  initImageLoader({ createImage: () => new FakeImage() });
}

// ── 1. A single asker is told when the image lands ───────────────────────────
{
  reset();
  let told = 0;
  ensureArtLoaded(ORI, () => told++);
  check('asking starts exactly one load', made.length === 1, `${made.length} loads`);
  check('and the caller is not told before it lands', told === 0);
  made[0].land();
  check('the caller is told when it lands', told === 1, `told ${told} times`);
  check('and the image is cached', artCache.Ori === made[0]);
}

// ── 2. A second asker mid-flight is told by the FIRST load ───────────────────
// The whole point of the queue, and the case the WebGL layer used to orphan.
{
  reset();
  let a = 0, b = 0;
  ensureArtLoaded(ORI, () => a++);
  ensureArtLoaded(ORI, () => b++);
  check('a second ask mid-flight starts no second load', made.length === 1, `${made.length} loads`);
  made[0].land();
  check('the first caller is told', a === 1, `told ${a}`);
  check('the second caller is told too', b === 1, `told ${b}`);
}

// ── 3. Every queued caller is told exactly once ──────────────────────────────
{
  reset();
  const counts = [0, 0, 0, 0];
  counts.forEach((_, i) => ensureArtLoaded(ORI, () => counts[i]++));
  made[0].land();
  check('all four queued callers are told', counts.every(c => c === 1), counts.join(','));
  // A load cannot land twice in a browser, but the queue must not be re-drainable —
  // a second drain would repaint every panel that has since moved on.
  made[0].land();
  check('and a second landing tells nobody again', counts.every(c => c === 1), counts.join(','));
}

// ── 4. Two constellations sharing one artwork share one load ─────────────────
// Vela and Puppis display Carina's artwork (ART_ALIAS). The cache is keyed by SOURCE,
// so asking for either must not fetch the same picture twice on a metered connection.
{
  reset();
  let carTold = 0, velTold = 0;
  ensureArtLoaded(CAR, () => carTold++);
  ensureArtLoaded(VEL, () => velTold++);
  check('a shared artwork loads once for both constellations', made.length === 1,
    `${made.length} loads`);
  made[0].land();
  check('and both askers are told', carTold === 1 && velTold === 1, `${carTold},${velTold}`);
}

// ── 5. An already-loaded image answers without a new load ────────────────────
// Deliberately WITHOUT invoking the callback: a caller that asks for artwork already in
// the cache has already painted it — paintReveal reads the cache directly — so the
// callback means "it arrived late", not "here it is". Worth pinning, because it is the
// kind of thing a new caller assumes the other way round.
{
  reset();
  ensureArtLoaded(ORI, () => {});
  made[0].land();
  let told = 0;
  ensureArtLoaded(ORI, () => told++);
  check('asking for cached artwork starts no load', made.length === 1, `${made.length} loads`);
  check('and does not fire the late-arrival callback', told === 0);
}

// ── 6. A failed image is known bad, and leaves nobody waiting ────────────────
{
  reset();
  let told = 0;
  ensureArtLoaded(ORI, () => told++);
  made[0].fail();
  check('a failed load is remembered as bad', artCache.Ori === 'error', String(artCache.Ori));
  check('its waiters are dropped, not called', told === 0,
    'a waiter repaints WITH the artwork; there is nothing to repaint with');
  check('nobody is left queued', (_artWaiting.Ori || []).length === 0);
  ensureArtLoaded(ORI, () => told++);
  check('and it is not retried on the next ask', made.length === 1, `${made.length} loads`);
}

// ── 7. A constellation with no artwork is a no-op ────────────────────────────
{
  reset();
  let told = 0;
  ensureArtLoaded(NONE, () => told++);
  check('no artwork means no load', made.length === 0);
  check('and no callback', told === 0);
}

// ── 8. Nothing outside render.js writes the artwork cache ────────────────────
// The invariant the bug broke. explore-gl.js used to assign artCache[src] = 'loading'
// and then the image, which is how the queue got orphaned — reads are fine and stay.
//
// Scope is derived from what this claims to cover, not from what came to mind — four
// guards in this repo have fired correctly while looking in the wrong place. The claim
// here is precise: among the files that share render.js's global scope, only render.js
// writes its cache. So the pages are FILTERED to the ones that actually load render.js,
// computed rather than listed.
//
// That filter is load-bearing, and the broad version found out why: fix.html and
// align-art.html — the standalone alignment tools — each declare an `artCache` of their
// own and never load render.js. They are separate programs that happen to share a name,
// not writers of this cache, and folding them in would have meant either a permanently
// red guard or an exclusion list that quietly grows.
{
  const root = path.join(__dirname, '..');
  const WRITES_CACHE = /artCache\s*\[[^\]]*\]\s*=[^=]/;
  const stripComments = src => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  const withExt = (dir, ext) => fs.readdirSync(path.join(root, dir))
    .filter(f => f.endsWith(ext))
    .map(f => path.join(root, dir, f));
  const loadsRenderJs = f => fs.readFileSync(f, 'utf8').includes('js/render.js');
  const files = [
    ...withExt('js', '.js'), ...withExt('perf', '.js'),
    ...withExt('.', '.html').filter(loadsRenderJs),
    ...withExt('perf', '.html').filter(loadsRenderJs),
  ];

  const writers = files
    .filter(f => WRITES_CACHE.test(stripComments(fs.readFileSync(f, 'utf8'))))
    .map(f => path.relative(root, f));

  check(`only js/render.js writes artCache (${files.length} files scanned)`,
    writers.length === 1 && writers[0] === path.join('js', 'render.js'),
    writers.join(', ') || 'nobody writes it — is the owner still there?');

  // And nobody else CONSTRUCTS an image. Writing the cache is how the bug happened, but
  // it is not the invariant: a caller that does `new Image()` and paints from its own
  // variable never touches the cache, passes the check above, and has still re-created
  // the duplicate-load half of the bug — one picture fetched twice on a metered
  // connection, and a second arrival nobody is told about.
  //
  // One documented exception, not a blanket allowance: js/explore.js keeps a separate
  // photo cache feeding WebGL textures. Different consumer, self-consistent, and
  // deliberately out of #93's scope because it sits in the draw path #80 is open on.
  // If that ever gains an owner too, this list should shrink, never grow silently.
  const MAKES_IMAGE = /new\s+Image\s*\(/;
  const ALLOWED = [path.join('js', 'render.js'), path.join('js', 'explore.js')];
  const makers = files
    .filter(f => MAKES_IMAGE.test(stripComments(fs.readFileSync(f, 'utf8'))))
    .map(f => path.relative(root, f));
  const rogue = makers.filter(f => !ALLOWED.includes(f));

  check(`only the owner and the documented exception construct images (${makers.length} found)`,
    rogue.length === 0, rogue.join(', '));
}

console.log('');
if (failures.length === 0) { console.log('✅ ALL PASSED'); process.exit(0); }
else { console.log(`❌ ${failures.length} FAILURE(S)`); process.exit(1); }
