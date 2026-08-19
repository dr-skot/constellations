#!/usr/bin/env node
// Unit test for the route module (js/screens.js, round-2 candidate 2, spec #44).
//
// The router is driven here exactly the way the browser drives it — every impure
// dependency is injected at initRouter, so a recording history port, a recording
// setScreen sink and stub enter actions are enough to observe everything that
// matters: which hash was written and whether it was a push or a replace, which
// action ran with which parameter, and which screen ended up active.
//
// Assertions stay on that observable surface. The route table's shape and the
// module's private fields are deliberately never touched.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const jsDir = path.join(__dirname, '..', 'js');
vm.runInThisContext(fs.readFileSync(path.join(jsDir, 'screens.js'), 'utf8'), { filename: 'screens.js' });

const failures = [];
const check = (name, ok, detail) => ok ? console.log(`OK: ${name}`)
  : (failures.push(name), console.log(`FAIL: ${name}` + (detail ? ` — ${detail}` : '')));

// A router wired to recorders. `rec.hist` is the history tape as ['push'|'replace', hash]
// pairs; `rec.screens` every screen the sink was handed; `rec.fired` every enter action
// that ran, as 'name' or 'name:param'; `rec.exits` every exit action that ran.
function mkRouter() {
  const rec = { hist: [], screens: [], fired: [], exits: [], seenScreen: [] };
  const names = ['course', 'explore', 'exploreCon', 'view', 'lesson', 'result', 'settings', 'calibration'];
  const actions = {};
  for (const n of names) actions[n] = param => {
    rec.fired.push(param == null ? n : `${n}:${param}`);
    rec.seenScreen.push(currentScreen());   // what the screen was when the action ran
  };
  const exits = {};
  for (const n of names) exits[n] = () => rec.exits.push(n);
  initRouter({
    history: { push: h => rec.hist.push(['push', h]), replace: h => rec.hist.push(['replace', h]) },
    setScreen: s => rec.screens.push(s),
    actions,
    exits,
  });
  rec.lastHist = () => rec.hist[rec.hist.length - 1];
  rec.lastScreen = () => rec.screens[rec.screens.length - 1];
  return rec;
}

// ---- parseRoute: hash → route ----------------------------------------------
{
  check('parseRoute: an empty hash is the course home',
    parseRoute('').name === 'course' && parseRoute('').screen === 'start');
  check('parseRoute: course maps to the start screen — the mapping lives in the table',
    parseRoute('course').screen === 'start');
  check('parseRoute: a leading # is ignored', parseRoute('#settings').name === 'settings');
  check('parseRoute: explore', parseRoute('explore').name === 'explore' && parseRoute('explore').screen === 'explore');
  check('parseRoute: explore/<abbr> carries its parameter',
    parseRoute('explore/Ori').name === 'exploreCon' && parseRoute('explore/Ori').param === 'Ori');
  // The constellation viewer is its own screen (issue #73). It used to declare the
  // identify screen, which made "am I in a quiz?" answerable only wrongly: the viewer
  // borrowed the screen, wrote a one-question lesson session and marked it answered.
  check('parseRoute: view/<abbr> carries its parameter and shows the viewer screen',
    parseRoute('view/Ori').name === 'view' && parseRoute('view/Ori').param === 'Ori'
    && parseRoute('view/Ori').screen === 'view');
  check('parseRoute: no route declares the identify screen — only a flow puts it up',
    ['course', 'explore', 'explore/Ori', 'view/Ori', 'settings']
      .every(h => parseRoute(h).screen !== 'identify'));
  check('parseRoute: lesson is flow-owned (declares no screen)',
    parseRoute('lesson').name === 'lesson' && parseRoute('lesson').screen === null);
  check('parseRoute: calibration is flow-owned (declares no screen)',
    parseRoute('calibration').name === 'calibration' && parseRoute('calibration').screen === null);
  check('parseRoute: result is transient',
    parseRoute('result').name === 'result' && parseRoute('result').transient === true);
  check('parseRoute: settings', parseRoute('settings').screen === 'settings');
  check('parseRoute: an unknown hash names no route', parseRoute('bogus') === null);
  check('parseRoute: a bare parameterized prefix names no route', parseRoute('view/') === null);
}

// ---- navigate: screen, action, history -------------------------------------
{
  const rec = mkRouter();
  navigate('settings');
  check('navigate: pushes the hash', rec.lastHist()[0] === 'push' && rec.lastHist()[1] === 'settings');
  check('navigate: shows the declared screen', rec.lastScreen() === 'settings');
  check('navigate: fires the enter action', rec.fired.join() === 'settings');
  check('navigate: currentRoute reports the route', currentRoute().name === 'settings');
  check('navigate: currentScreen reports the screen', currentScreen() === 'settings');
}
{
  const rec = mkRouter();
  navigate('view/Ori');
  check('navigate: a parameterized route hands its parameter to the action', rec.fired.join() === 'view:Ori');
}
{
  const rec = mkRouter();
  navigate('course');
  check('navigate: course shows the start screen', rec.lastScreen() === 'start');
}

// ---- the screen is applied BEFORE the enter action runs ---------------------
// The constellation viewer measures its picture, which has no layout while its screen
// is inactive — so this ordering is load-bearing, not cosmetic.
{
  const rec = mkRouter();
  navigate('view/Ori');
  check('the enter action observes its screen already active', rec.seenScreen.join() === 'view');
}

// ---- redirects replace, never push -----------------------------------------
// A dead URL must not leave a history entry, or pressing back once returns to it.
{
  const rec = mkRouter();
  navigate('course');
  const before = rec.fired.length;
  enterRoute('bogus');
  check('unknown hash: redirects to the course home', currentRoute().name === 'course');
  check('unknown hash: redirects by REPLACE, not push',
    rec.lastHist()[0] === 'replace' && rec.lastHist()[1] === 'course');
  check('unknown hash: no action fires for the unknown route',
    rec.fired.slice(before).join() === 'course');
}
{
  const rec = mkRouter();
  enterRoute('view/');
  check('a bare parameterized prefix redirects to the course home', currentRoute().name === 'course');
}

// ---- transient routes ------------------------------------------------------
// #result is reachable only from inside the app: a finished lesson lives in memory
// alone, so a reload must land on the course home instead of silently starting a
// fresh lesson (the demonstrable bug in spec #44).
{
  const rec = mkRouter();
  navigate('lesson');
  navigate('result');
  check('result: entering from inside the app shows the result screen',
    currentRoute().name === 'result' && rec.lastScreen() === 'result');
}
{
  // Ending a lesson REPLACES the spent #lesson entry rather than pushing over it.
  // Pushing leaves #lesson one Back away, and going back there resolves a lesson
  // whose stored session was cleared when it ended — which starts a brand-new
  // lesson. That is the very bug #result exists to kill, only reached by Back.
  const rec = mkRouter();
  navigate('course');
  navigate('lesson');
  navigate('result', { replace: true });
  check('result: ending a lesson replaces the spent lesson entry',
    rec.lastHist()[0] === 'replace' && rec.lastHist()[1] === 'result');
  check('result: replacing still shows the screen and fires the action',
    rec.lastScreen() === 'result' && rec.fired[rec.fired.length - 1] === 'result');
  check('replace: the lesson entry is gone, so Back leads to what preceded it',
    rec.hist.map(h => h[1]).join() === 'course,lesson,result'
    && rec.hist.map(h => h[0]).join() === 'push,push,replace');
}
{
  const rec = mkRouter();
  enterRoute('result', { write: 'replace' });      // a cold start on #result
  check('result: a cold start redirects to the course home', currentRoute().name === 'course');
  check('result: a cold start never fires the result action', rec.fired.join() === 'course');
  check('result: a cold start never shows the result screen', rec.screens.join() === 'start');
}
{
  const rec = mkRouter();
  navigate('result');
  enterRoute('result');                            // forward/back onto #result
  check('result: a popstate entry redirects too', currentRoute().name === 'course');
}

// ---- boot writes its resolved hash -----------------------------------------
{
  const rec = mkRouter();
  enterRoute('calibration', { write: 'replace' });
  check('boot: writes the resolved entry hash by replace',
    rec.hist.length === 1 && rec.hist[0][0] === 'replace' && rec.hist[0][1] === 'calibration');
  check('boot: fires the entry route action', rec.fired.join() === 'calibration');
}
{
  const rec = mkRouter();
  enterRoute('', { write: 'replace' });
  check('boot: an empty hash resolves to the course home and is written',
    rec.hist[0][1] === 'course' && currentRoute().name === 'course');
}

// ---- popstate writes no history --------------------------------------------
{
  const rec = mkRouter();
  navigate('explore');
  const n = rec.hist.length;
  enterRoute('settings');
  check('popstate: entering writes no history', rec.hist.length === n);
  check('popstate: still applies the screen and action',
    rec.lastScreen() === 'settings' && rec.fired[rec.fired.length - 1] === 'settings');
}

// ---- same-hash navigation replaces, but still acts -------------------------
// Tapping the gear twice must not stack duplicate entries; the level-check retake
// button re-enters calibration from calibration and must still restart the flow.
{
  const rec = mkRouter();
  navigate('settings');
  navigate('settings');
  check('same hash: the second navigation replaces rather than pushes',
    rec.hist[0][0] === 'push' && rec.hist[1][0] === 'replace');
  check('same hash: the enter action still fires', rec.fired.join() === 'settings,settings');
}
{
  const rec = mkRouter();
  navigate('view/Ori');
  navigate('view/Cyg');
  check('same route, different parameter: still a push',
    rec.hist[1][0] === 'push' && rec.fired.join() === 'view:Ori,view:Cyg');
}

// ---- flow-owned routes -----------------------------------------------------
// lesson and calibration declare no screen: the flow chooses one as it advances,
// and currentScreen() must follow it without the route changing.
{
  const rec = mkRouter();
  navigate('course');
  rec.screens.length = 0;
  navigate('lesson');
  check('flow-owned: entering sets no screen by itself', rec.screens.length === 0);
  check('flow-owned: the screen from before the entry is still current', currentScreen() === 'start');
  showScreen('identify');
  check('flow-owned: the flow can set the screen', currentScreen() === 'identify' && rec.lastScreen() === 'identify');
  check('flow-owned: setting a screen does not change the route', currentRoute().name === 'lesson');
  showScreen('explore');                            // a find question
  check('flow-owned: the flow can switch screens again within the route',
    currentScreen() === 'explore' && currentRoute().name === 'lesson');
}

// ---- exit actions ----------------------------------------------------------
{
  const rec = mkRouter();
  navigate('calibration');
  navigate('course');
  check('leaving a route fires its exit action', rec.exits.join() === 'calibration');
}
{
  const rec = mkRouter();
  navigate('calibration');
  navigate('calibration');                          // the retake button
  check('re-entering the same route does not fire its exit action', rec.exits.join() === '');
}
{
  const rec = mkRouter();
  navigate('view/Ori');
  navigate('view/Cyg');
  check('moving within one route does not fire its exit action', rec.exits.join() === '');
}

// ---- detours ---------------------------------------------------------------
// Leaving somewhere meaning to come back. The finding guide launched from a quiz
// question or a level-check probe is the case: finishing it must return the learner
// to the exact question they left, still counting.
{
  const rec = mkRouter();
  navigate('calibration');
  let resumed = 0;
  beginDetour(() => resumed++);
  navigate('explore/Ori');
  check('detour: departing does not fire the departed route exit action', rec.exits.join() === '');
  check('detour: a detour is in flight', inDetour() === true);
  check('detour: the departure itself is a normal navigation',
    rec.lastHist()[0] === 'push' && currentRoute().name === 'exploreCon');
  const firedBefore = rec.fired.length;
  endDetour();
  check('detour: ending restores the hash by replace',
    rec.lastHist()[0] === 'replace' && rec.lastHist()[1] === 'calibration');
  check('detour: ending restores the route', currentRoute().name === 'calibration');
  check('detour: ending runs the resume thunk', resumed === 1);
  check('detour: ending does NOT re-run the enter action', rec.fired.length === firedBefore);
  check('detour: no exit action fires on the way back', rec.exits.join() === '');
  check('detour: no detour is in flight afterwards', inDetour() === false);
}
{
  // Ending a detour must not re-run the enter action: re-entering #lesson would try
  // to resume from storage, which a level check never wrote.
  const rec = mkRouter();
  navigate('lesson');
  showScreen('identify');
  beginDetour(() => showScreen('identify'));
  navigate('explore/Ori');
  endDetour();
  check('detour: returning to a flow-owned route restores its screen via the resume thunk',
    currentRoute().name === 'lesson' && currentScreen() === 'identify');
  check('detour: the lesson enter action ran exactly once', rec.fired.filter(f => f === 'lesson').length === 1);
}
{
  // Abandoned by tapping a breadcrumb: the detour is dropped and the exit action the
  // departure deferred fires now. Today that bookkeeping is simply left dangling.
  const rec = mkRouter();
  navigate('calibration');
  beginDetour(() => {});
  navigate('explore/Ori');
  navigate('course');
  check('detour: navigating on cancels it', inDetour() === false);
  check('detour: cancelling fires the deferred exit action', rec.exits.includes('calibration'));
  check('detour: the abandoned route is not restored', currentRoute().name === 'course');
}
{
  const rec = mkRouter();
  navigate('calibration');
  beginDetour(() => {});
  navigate('explore/Ori');
  enterRoute('course');                              // the back button
  check('detour: a popstate cancels it too',
    inDetour() === false && rec.exits.includes('calibration'));
}
{
  const rec = mkRouter();
  navigate('course');
  endDetour();                                       // nothing in flight
  check('detour: ending with none in flight is a no-op',
    rec.hist.length === 1 && currentRoute().name === 'course');
}
{
  // Returning to the origin route by hand rather than by finishing the guide: the
  // detour is dropped, but this is not a departure, so no exit action fires.
  const rec = mkRouter();
  navigate('calibration');
  beginDetour(() => {});
  navigate('explore/Ori');
  navigate('calibration');
  check('detour: navigating back to the origin route drops it without firing its exit action',
    inDetour() === false && !rec.exits.includes('calibration'));
}

// ---- which routes come back, and how (issues #74, #76) ---------------------
// Whether a departure means to come back is a property of the ROUTE being left, and
// what to do on the way back differs per route. It used to be decided by asking which
// SCREEN was showing and treating the identify screen as "mid-question" — true in the
// constellation viewer too, which is why leaving a finding guide re-rendered the
// lesson's current question over the viewer (issue #69).
//
// Asking the screen was wrong a second way, which issue #76 fixed: a QUIZ renders an
// identify question on the identify screen and a find question on the explorer, and both
// are quiz questions. Treating "not the identify screen" as "no question to come back to"
// stranded a learner who opened a finding guide from an answered find question (#75).
// So an entry answers from the FLOW — is a question on display? — never from the surface
// that question happens to be rendered on.
//
// The resume thunks are injected like the enter and exit actions, so the router can be
// asked to start a detour without being told what coming back means.
function mkDetourRouter() {
  const rec = mkRouter();
  rec.resumed = [];
  rec.hasQuestion = true;   // does the flow have a question on display right now?
  initRouter({
    history: { push: h => rec.hist.push(['push', h]), replace: h => rec.hist.push(['replace', h]) },
    setScreen: s => rec.screens.push(s),
    actions: { view: p => rec.fired.push('view:' + p), lesson: () => rec.fired.push('lesson'),
               calibration: () => rec.fired.push('calibration'), explore: () => rec.fired.push('explore'),
               exploreCon: p => rec.fired.push('exploreCon:' + p), course: () => rec.fired.push('course') },
    exits: { calibration: () => rec.exits.push('calibration') },
    // Each entry is asked for a resume thunk and may answer null — "not from here".
    // rec.hasQuestion stands in for what backToQuestion() asks the flow. It is
    // deliberately NOT a screen: the same resume serves both kinds of question, because
    // the question renderer picks its own surface.
    detours: {
      lesson:      () => rec.hasQuestion ? () => rec.resumed.push('question') : null,
      calibration: () => rec.hasQuestion ? () => rec.resumed.push('probe') : null,
      view:        param => () => rec.resumed.push('viewer:' + param),
    },
  });
  return rec;
}

{
  // The viewer comes back as the viewer, with the constellation it was showing.
  const rec = mkDetourRouter();
  navigate('view/Ori');
  beginDetourFromRoute();
  check('a detour from the viewer is in flight', inDetour() === true);
  navigate('explore/Ori');                       // into the finding guide
  endDetour();
  check('leaving a guide opened from the viewer restores its hash',
    rec.lastHist().join() === 'replace,view/Ori', String(rec.lastHist()));
  check('and re-renders the VIEWER, not a lesson question',
    rec.resumed.join() === 'viewer:Ori', rec.resumed.join());
}

{
  // An identify question comes back as that question (issue #35), unchanged.
  const rec = mkDetourRouter();
  navigate('lesson');
  beginDetourFromRoute();
  navigate('explore/Ori');
  endDetour();
  check('leaving a guide opened from an identify question returns to the question',
    rec.resumed.join() === 'question' && rec.lastHist().join() === 'replace,lesson',
    `${rec.resumed.join()} / ${rec.lastHist()}`);
}

{
  // ...and so does a FIND question (issue #76), by the same route and the same resume.
  // The guide is opened from the explorer, which is also the surface the find question was
  // being rendered on, so the departure looks like "explore → explore" — and the router
  // must still come back to #lesson rather than treating that as staying put.
  //
  // BE HONEST ABOUT WHAT THIS COVERS. The decision that a find question counts as "a
  // question on display" is questionOnDisplay() in main.js, which node cannot load; here
  // it is the rec.hasQuestion stand-in. So this block locks the ROUTER's half — one resume
  // serves both kinds, and the round trip lands back on the lesson — and cannot catch a
  // regression in the predicate itself. That half is covered by the live walk-through in
  // the ticket, and by the fact that this file no longer asserts the old behaviour.
  const rec = mkDetourRouter();
  navigate('lesson');
  check('a route with a question open a detour whichever surface renders it',
    beginDetourFromRoute() === true);
  navigate('explore/Ori');
  endDetour();
  check('leaving a guide opened from the explorer still returns to #lesson',
    rec.resumed.join() === 'question' && rec.lastHist().join() === 'replace,lesson',
    `${rec.resumed.join()} / ${rec.lastHist()}`);
  check('and the lesson enter action does not re-run, so the question is not re-asked',
    rec.fired.filter(f => f === 'lesson').length === 1, rec.fired.join());
}

{
  // A level-check probe likewise.
  const rec = mkDetourRouter();
  navigate('calibration');
  beginDetourFromRoute();
  navigate('explore/Ori');
  endDetour();
  check('leaving a guide opened from a probe returns to the probe',
    rec.resumed.join() === 'probe', rec.resumed.join());
}

{
  // From the explorer there is nowhere to come back to: no detour at all, so the
  // learner is simply left where the guide put them.
  const rec = mkDetourRouter();
  navigate('explore');
  beginDetourFromRoute();
  check('a guide opened from the explorer opens no detour', inDetour() === false);
  navigate('explore/Ori');
  endDetour();
  check('and ending one that never began changes nothing', rec.resumed.join() === '');
}

{
  // A route may still decline from where it currently is — but the reason is now "there
  // is no question here", not "the question is on the wrong surface". The level check
  // shows its offer and its payoff on the calibration route with no probe on display;
  // there is nothing to come back to, so the guide's own exit handles the return.
  const rec = mkDetourRouter();
  rec.hasQuestion = false;
  navigate('calibration');
  check('a route with no question on display declines', beginDetourFromRoute() === false);
  check('and none is in flight', inDetour() === false);

  rec.hasQuestion = true;
  check('the same route opens one once a probe is showing',
    beginDetourFromRoute() === true);
}

{
  // Abandoning it still behaves: navigating on cancels, and the deferred exit fires.
  const rec = mkDetourRouter();
  navigate('calibration');
  beginDetourFromRoute();
  navigate('explore/Ori');
  navigate('course');
  check('a route-chosen detour is still cancelled by navigating on',
    inDetour() === false && rec.exits.includes('calibration') && rec.resumed.join() === '');
}

console.log('');
if (failures.length === 0) { console.log('✅ ALL PASSED'); process.exit(0); }
else { console.log(`❌ ${failures.length} FAILURE(S)`); process.exit(1); }
