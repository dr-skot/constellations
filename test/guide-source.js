#!/usr/bin/env node
// The guide source (issue #87, spec #82): the single home for loading, preparing and
// validating a finding guide.
//
// fetch is injected at initGuideSource, so the whole module runs here against a fake —
// the cache, the null path, the rejection path, the random fill, the roll and the schema
// gate. That is the point of injecting it: before this, the pipeline lived half in
// find-guide.js and half in an inline <script>, and neither half was reachable from node.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const jsDir = path.join(root, 'js');

// data.js, projection.js and guide-renderer.js touch these at load.
global.window = global;
global.addEventListener = () => {};
// cache-stamp.js reads the page's ?v= off the first stamped script or link. A document
// that answers null gives an EMPTY stamp, which makes stampedUrl(u) return u unchanged —
// and that turns any "did this go through stampedUrl?" assertion into u === u, true for a
// bare fetch too. The review caught this file asserting exactly that. Serve a real stamp
// so the fence assertion below can actually fail.
const TEST_STAMP = 'abc123def456';
global.document = {
  getElementById: () => null,
  querySelector: () => ({ getAttribute: () => `js/anything.js?v=${TEST_STAMP}` }),
};
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const origLog = console.log; console.log = () => {};
// step-display.js before guide-source.js, as both pages load them: the schema gate reads
// _SD_LAYERS from it rather than retyping the layer names.
for (const f of ['cache-stamp.js', 'data.js', 'projection.js', 'step-display.js',
                 'guide-renderer.js', 'guide-source.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(jsDir, f), 'utf8'), { filename: f });
}
console.log = origLog;

const failures = [];
const check = (name, ok, detail) => ok ? console.log(`OK: ${name}`)
  : (failures.push(name), console.log(`FAIL: ${name}` + (detail ? ` — ${detail}` : '')));

// ── A fake sky ───────────────────────────────────────────────────────────────
// Small enough to reason about, shaped like the real data: an opening `random` step
// plus fixed ones, and a guide with no steps to exercise the "no guide" path.
const GUIDES = {
  Orion: {
    rotation: -0.127,
    steps: [
      { random: true, fov: 90, title: 'Orient yourself', caption: 'Look up.' },
      { ra: 83.8, dec: -1.2, fov: 30, title: 'The belt', caption: 'Three in a row.',
        highlight: ['Mintaka'], diagram: true },
      { ra: 88.8, dec: 7.4, fov: 20, rotation: 0.5, title: 'Betelgeuse', caption: 'Red.' },
    ],
  },
  Lyra: {
    steps: [
      { random: true, fov: 90, title: 'Start', caption: 'Anywhere.' },
      { ra: 279.2, dec: 38.8, fov: 25, title: 'Vega', caption: 'Bright.' },
    ],
  },
  Antlia: { steps: [] },        // present but empty — no guide, as far as callers go
};

const CATALOG = { Mintaka: { ra: 83.0, dec: -0.3 } };

const ORI = { name: 'Orion', abbr: 'Ori', ra: 83.0, dec: 5.0 };
const LYR = { name: 'Lyra', abbr: 'Lyr', ra: 283.0, dec: 36.0 };
const ANT = { name: 'Antlia', abbr: 'Ant', ra: 152.0, dec: -32.0 };
const NOPE = { name: 'Nosuchopia', abbr: 'Nop', ra: 0, dec: 0 };

const ORIGIN = { ra: 80, dec: 5 };

// A fake fetch that counts calls and can be told to fail.
function makeFetch({ fail = false } = {}) {
  const calls = [];
  const fn = url => {
    calls.push(url);
    if (fail) return Promise.reject(new Error('network down'));
    const body = url.indexOf('finding-guides') !== -1 ? GUIDES : CATALOG;
    return Promise.resolve({ json: () => Promise.resolve(body) });
  };
  fn.calls = calls;
  return fn;
}

async function main() {
  // ── The cache ──────────────────────────────────────────────────────────────
  // Four questions, two fetches. The old find-guide.js kept _guidesCache for exactly
  // this reason and the inline copy in find-help.html had no cache at all.
  {
    const fetch = makeFetch();
    initGuideSource({ fetch });
    await Promise.all([
      hasGuide(ORI), hasGuide(LYR),
      prepareGuide(ORI, { origin: ORIGIN }), skyCatalog(),
    ]);
    check('four questions cost two fetches', fetch.calls.length === 2,
          `made ${fetch.calls.length}: ${fetch.calls.join(', ')}`);
  }

  // ── No guide, versus a load that failed ────────────────────────────────────
  // Two outcomes, deliberately different: find-help.html already writes "No finding
  // guide is available for this constellation yet" for one and "Could not load finding
  // guide." for the other, and a single null would collapse them.
  {
    const fetch = makeFetch();
    initGuideSource({ fetch });
    check('hasGuide is false for a guide with no steps', (await hasGuide(ANT)) === false);
    check('hasGuide is false for a constellation not in the data', (await hasGuide(NOPE)) === false);
    check('hasGuide is true for a written guide', (await hasGuide(ORI)) === true);
    check('prepareGuide resolves null for a guide with no steps',
          (await prepareGuide(ANT, { origin: ORIGIN })) === null);
    check('prepareGuide resolves null for a constellation not in the data',
          (await prepareGuide(NOPE, { origin: ORIGIN })) === null);
  }
  {
    const fetch = makeFetch({ fail: true });
    initGuideSource({ fetch });
    let rejected = false;
    await prepareGuide(ORI, { origin: ORIGIN }).catch(() => { rejected = true; });
    check('prepareGuide rejects when the load fails', rejected);
  }

  // A failed load must not be remembered as an answer. find-guide.js only ever assigned
  // _guidesCache on success, so a guide tapped after a dropped connection tried again;
  // caching the rejected promise would make the first failure permanent for the session.
  {
    let attempts = 0, failing = true;
    const fetch = url => {
      attempts++;
      if (failing) return Promise.reject(new Error('network down'));
      const body = url.indexOf('finding-guides') !== -1 ? GUIDES : CATALOG;
      return Promise.resolve({ json: () => Promise.resolve(body) });
    };
    initGuideSource({ fetch });
    await prepareGuide(ORI, { origin: ORIGIN }).catch(() => {});
    failing = false;
    const second = await prepareGuide(ORI, { origin: ORIGIN }).catch(() => null);
    check('a failed load is retried rather than remembered', second !== null,
          `second attempt still failed after ${attempts} fetch call(s)`);
  }

  // ── The prep ───────────────────────────────────────────────────────────────
  // `origin` is the caller's answer to "where is the learner looking?" — the current
  // view in-app, a random sky point standalone. The module never reaches for explore.P,
  // which is the whole reason it runs here at all.
  {
    initGuideSource({ fetch: makeFetch() });
    const g = await prepareGuide(ORI, { origin: ORIGIN });
    const opener = g.steps[0];
    check('the random step is filled from origin',
          opener.ra === ORIGIN.ra && opener.dec === ORIGIN.dec,
          `got ra=${opener.ra} dec=${opener.dec}`);
    check('the random step keeps its own fov and copy',
          opener.fov === 90 && opener.title === 'Orient yourself');
    check('a fixed step is untouched',
          g.steps[1].ra === 83.8 && g.steps[1].dec === -1.2 && g.steps[1].fov === 30);

    const other = await prepareGuide(ORI, { origin: { ra: 200, dec: -40 } });
    check('a second call fills from its own origin',
          other.steps[0].ra === 200 && other.steps[0].dec === -40);
  }

  // Every guide's opening step is `random`, and a random step carries no coordinates of
  // its own — it is told where to point at prepare time. So a missing origin does not
  // degrade, it produces an opener with no ra/dec at all, and raDecToVec(undefined,
  // undefined) points the camera at NaN: a blank sky, no error, no complaint. The schema
  // gate cannot catch it either, since it exempts random steps from carrying coordinates.
  //
  // A THROW rather than a rejection, and deliberately: a rejection means "the load
  // failed", and find-help.html renders that as "Could not load finding guide." Calling
  // the function wrong is not a network problem and must not be reported as one. Same
  // treatment as guideStart's roll (#88), for the same reason.
  {
    initGuideSource({ fetch: makeFetch() });
    let threw = false;
    try { prepareGuide(ORI); } catch (e) { threw = /origin/.test(e.message); }
    check('prepareGuide throws when origin is missing', threw);

    let threwOnPartial = false;
    try { prepareGuide(ORI, { origin: { ra: 80 } }); } catch (e) { threwOnPartial = true; }
    check('prepareGuide throws when origin is half an answer', threwOnPartial);
  }

  // The cached guide must survive being prepared. guideStart mutates nothing today, but
  // find-guide.js copied defensively for a reason: the cache is shared by every caller,
  // and one host writing through it would silently reshape the next host's guide.
  {
    initGuideSource({ fetch: makeFetch() });
    const first = await prepareGuide(ORI, { origin: ORIGIN });
    first.steps[1].ra = 999;
    first.steps.push({ ra: 1, dec: 1, fov: 1 });
    const second = await prepareGuide(ORI, { origin: ORIGIN });
    check('mutating a prepared guide does not reach the cache',
          second.steps.length === 3 && second.steps[1].ra === 83.8,
          `got ${second.steps.length} steps, [1].ra=${second.steps[1].ra}`);
  }

  // ── The roll ───────────────────────────────────────────────────────────────
  // Two branches: north-up at the constellation, plus the guide's own rotation where it
  // sets one. Only 2 of the 88 real guides do (Orion and Ursa Major), so the fallback is
  // the case that carries the corpus.
  //
  // The expected values come from js/guide-renderer.js's guideNorthUpR — the same
  // primitive the old stanza called, not a re-derivation of it. What is being tested is
  // the COMPOSITION this module took over, which is where the two hosts differed and
  // where the ordering contract lived. The golden in test/guide-source-golden.json is the
  // independent check on the whole corpus; #89 replays it.
  {
    initGuideSource({ fetch: makeFetch() });
    const northUpOri = guideNorthUpR(raDecToVec(ORI.ra, ORI.dec));
    const northUpLyr = guideNorthUpR(raDecToVec(LYR.ra, LYR.dec));

    const lyr = await prepareGuide(LYR, { origin: ORIGIN });
    check('with no guide rotation the roll is north-up at the constellation',
          lyr.roll === northUpLyr, `got ${lyr.roll}, want ${northUpLyr}`);

    const ori = await prepareGuide(ORI, { origin: ORIGIN });
    check('a guide rotation is added to north-up',
          ori.roll === northUpOri + (-0.127), `got ${ori.roll}, want ${northUpOri - 0.127}`);
    check('the two branches actually differ', ori.roll !== northUpOri);
  }

  // ── The schema gate ────────────────────────────────────────────────────────
  // The step schema is 15 fields and splits in two: step-display.js owns the nine that
  // say WHAT TO SHOW, and nothing owned the six that say WHERE TO POINT and WHAT TO SAY.
  // This gates those six, reporting `problems` the way makeStepDisplay does — same idiom,
  // so a maintainer reads one kind of complaint, not two.
  //
  // It must NOT complain about step-display's own fields; a step legitimately carrying
  // `highlight` and `diagram` is not malformed.
  {
    const BAD = {
      Bad: {
        steps: [
          { random: true, fov: 90, title: 'a', caption: 'b' },
          { ra: 1, dec: 2, fov: 3, title: 'c', caption: 'd', hilight: ['Rigel'] },  // typo
          { dec: 2, fov: 3, title: 'e', caption: 'f' },                             // no ra
        ],
      },
    };
    initGuideSource({
      fetch: url => Promise.resolve({
        json: () => Promise.resolve(url.indexOf('finding-guides') !== -1 ? BAD : CATALOG),
      }),
    });
    const g = await prepareGuide({ name: 'Bad', abbr: 'Bad', ra: 0, dec: 0 }, { origin: ORIGIN });
    const joined = (g.problems || []).join(' | ');
    check('a key nothing reads is reported', /hilight/.test(joined), joined);
    check('a fixed step with no ra is reported', /\bra\b/.test(joined), joined);
    check('the random step is not asked for an ra it does not carry',
          !/#0/.test(joined), joined);
  }
  {
    initGuideSource({ fetch: makeFetch() });
    const g = await prepareGuide(ORI, { origin: ORIGIN });
    check('a sound guide reports no problems', g.problems.length === 0,
          g.problems.join(' | '));
    check("step-display's own fields are not flagged here",
          !/highlight|diagram/.test(g.problems.join(' ')));
  }

  // A typo in a GUIDE-level key is worse than one in a step: `rotaion` is silently
  // ignored and the whole guide flies at the wrong roll, every step of it. The per-step
  // sweep was already here; the guide object was not being swept at all.
  {
    const TYPO = { Typo: { rotaion: 0.31, steps: [{ random: true, fov: 90, title: 'a', caption: 'b' }] } };
    initGuideSource({
      fetch: url => Promise.resolve({
        json: () => Promise.resolve(url.indexOf('finding-guides') !== -1 ? TYPO : CATALOG),
      }),
    });
    const g = await prepareGuide({ name: 'Typo', abbr: 'Typ', ra: 0, dec: 0 }, { origin: ORIGIN });
    check('a misspelled guide-level key is reported', /rotaion/.test(g.problems.join(' | ')),
          g.problems.join(' | '));
  }

  // A stub is the shape of corruption the gate is least able to see: _guideFor treats a
  // guide with no steps as "no guide", so it vanishes from the UI with nothing said. The
  // gate walks raw entries rather than filtered ones precisely so it can notice, and it
  // must not fall over on the way — a guide entry with no `steps` key at all used to
  // crash the walk with "Cannot read properties of undefined".
  {
    check('a guide with no steps key is reported, not thrown on',
          _guideProblems({ rotation: 0 }).some(p => /steps/.test(p)),
          JSON.stringify(_guideProblems({ rotation: 0 })));
    check('a guide stubbed with an empty steps array is reported',
          _guideProblems({ steps: [] }).some(p => /steps/.test(p)),
          JSON.stringify(_guideProblems({ steps: [] })));
  }

  // The gate defers to step-display for the layer names rather than keeping a copy. A
  // hand-copied list is a validator that eventually lies about the module it defers to:
  // add a layer there and valid data starts drawing "key nothing reads".
  {
    check('the layer names come from step-display, not a second copy',
          _gsKnownFields().length === GS_CAMERA_FIELDS.length + GS_COPY_FIELDS.length +
                                     _SD_LAYERS.length + GS_DISPLAY_EXTRAS.length &&
          _SD_LAYERS.every(n => _gsKnownFields().includes(n)),
          _gsKnownFields().join(','));
  }

  // ── Warming ────────────────────────────────────────────────────────────────
  // find-guide.js fired _loadGuides().catch(() => {}) at script load, so the first tap
  // was instant. With fetch injected there IS no fetch at load time, so warming becomes
  // something a host asks for — which is the better shape anyway: a module that opens a
  // connection merely by being on the page cannot be quietly loaded by a test or a tool.
  {
    const fetch = makeFetch();
    initGuideSource({ fetch });
    await warmGuideSource();
    check('warming loads the data', fetch.calls.length === 2, `${fetch.calls.length} calls`);
    await hasGuide(ORI);
    check('a question after warming costs no further fetch', fetch.calls.length === 2,
          `${fetch.calls.length} calls`);
  }
  {
    initGuideSource({ fetch: makeFetch({ fail: true }) });
    let threw = false;
    await warmGuideSource().catch(() => { threw = true; });
    check('warming swallows a failed load', !threw);
  }

  // ── The fence ──────────────────────────────────────────────────────────────
  // The whole reason this module exists is that one of the two hosts fetched outside the
  // ?v= fence (#83). Assert the module is inside it, so the next person to touch these
  // paths cannot quietly step back out.
  {
    const fetch = makeFetch();
    initGuideSource({ fetch });
    await warmGuideSource();
    check('the harness serves a non-empty stamp, so the next check can fail',
          cacheStamp() === TEST_STAMP, `stamp is "${cacheStamp()}"`);
    check('both fetches carry the page stamp',
          fetch.calls.every(u => u.indexOf(`?v=${TEST_STAMP}`) !== -1),
          fetch.calls.join(', '));
    check('it fetches the guides and the catalog, and nothing else',
          fetch.calls.length === 2 &&
          fetch.calls.some(u => u.indexOf('js/finding-guides.json') === 0) &&
          fetch.calls.some(u => u.indexOf('js/sky-objects.json') === 0),
          fetch.calls.join(', '));
  }

  // ── The golden: the whole real corpus, byte for byte ───────────────────────
  // test/guide-source-golden.json was captured BEFORE this module existed, from a verbatim
  // transcription of the prep stanza the two hosts open-coded (#86). Replaying it here is
  // what makes the move in #89 a proof rather than a claim: if the module prepares all 88
  // guides exactly as the old duplicated code did, moving the hosts onto it cannot change
  // what a learner sees.
  //
  // Fed the REAL data, and the same pinned origin the capture recorded — so a `random`
  // opener that fills differently shows up as a diff rather than as a coincidence.
  {
    const golden = JSON.parse(fs.readFileSync(path.join(root, 'test/guide-source-golden.json'), 'utf8'));
    const realGuides  = JSON.parse(fs.readFileSync(path.join(jsDir, 'finding-guides.json'), 'utf8'));
    const realCatalog = JSON.parse(fs.readFileSync(path.join(jsDir, 'sky-objects.json'), 'utf8'));
    initGuideSource({
      fetch: url => Promise.resolve({
        json: () => Promise.resolve(url.indexOf('finding-guides') !== -1 ? realGuides : realCatalog),
      }),
    });

    const diffs = [];
    for (const want of golden.guides) {
      const con = C.find(c => c.abbr === want.abbr);
      if (!con) { diffs.push(`${want.name}: not in the catalog`); continue; }
      const got = await prepareGuide(con, { origin: golden.origin });
      if (!got) { diffs.push(`${want.name}: prepareGuide returned null`); continue; }
      if (got.roll !== want.roll) diffs.push(`${want.name}: roll ${got.roll} != ${want.roll}`);
      if (JSON.stringify(got.steps) !== JSON.stringify(want.steps)) {
        diffs.push(`${want.name}: steps differ`);
      }
      if (got.problems.length) diffs.push(`${want.name}: ${got.problems.join('; ')}`);
    }
    check(`all ${golden.guides.length} real guides prepare exactly as captured`,
          diffs.length === 0, diffs.slice(0, 5).join(' | '));
  }

  // ── The corpus gate: is the guide data sound? ──────────────────────────────
  // One walk over all 88 guides and 338 steps, asking BOTH halves of the 15-field step
  // schema. A step declares two independent things (CONTEXT.md): where to point and what
  // to show. makeStepDisplay gates the nine fields of the second half; the guide source
  // gates the six of the first, plus the guide-level keys.
  //
  // One walk rather than two, and here rather than split across two files, because this
  // is an assertion about the DATA, not about either module. Someone editing 180 KB of
  // JSON wants one command that answers "is my data sound?", not two that each answer
  // half of it. test/step-display.js keeps its own golden replay — that is a regression
  // freeze on makeStepDisplay's output, which is a different question.
  {
    const guides  = JSON.parse(fs.readFileSync(path.join(jsDir, 'finding-guides.json'), 'utf8'));
    const catalog = JSON.parse(fs.readFileSync(path.join(jsDir, 'sky-objects.json'), 'utf8'));

    const problems = [];
    let stepCount = 0;
    for (const [name, guide] of Object.entries(guides)) {
      // Where to point, what to say, and the guide-level keys.
      for (const p of _guideProblems(guide)) problems.push(`${name} ${p}`);
      // What to show — unresolvable catalog ids, fields nothing reads.
      (guide.steps || []).forEach((step, i) => {
        stepCount++;
        for (const p of makeStepDisplay(step, catalog).problems) problems.push(`${name}#${i} — ${p}`);
      });
    }

    check(`the corpus is the expected size (88 guides, 338 steps)`,
          Object.keys(guides).length === 88 && stepCount === 338,
          `${Object.keys(guides).length} guides, ${stepCount} steps`);
    check('the guide data is sound across all 15 fields of the step schema',
          problems.length === 0, problems.slice(0, 8).join(' ; '));
  }

  console.log('');
  if (failures.length) {
    console.log(`❌ ${failures.length} FAILURE(S): ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('✅ ALL PASSED');
}

main().catch(e => { console.log('THREW:', e.message); process.exit(1); });
