// ═══════════════════════════════════════════════════════════
// ROUTES & SCREENS — the single owner of navigation
// ═══════════════════════════════════════════════════════════
//
// hash → route → screen. Every screen the learner can reach has a hash, and every
// screen change goes through here, so the address bar always describes what is on
// screen (spec #44). Before this module, half the navigations wrote the hash and
// half did not, which is why code elsewhere asked the DOM "which screen am I on?"
// and why leaving-and-returning was hand-rolled twice.
//
// No DOM, no globals: the impure dependencies are injected once at boot by main.js
// — a history port, a setScreen sink, the per-route enter actions and their exit
// actions — so the whole router can be driven under node (test/screens.js).

// ── The route table ─────────────────────────────────────────────────────────
// One row per route. `screen: null` marks a FLOW-OWNED route: the flow picks the
// screen as it advances (a lesson shows the identify screen or the explorer depending
// on the question; a level check shows its panels for the offer and payoff and the
// identify screen for the probes). `transient` marks a route whose data lives only in
// memory, so it can only be entered from inside the app.
const ROUTES = [
  { name: 'course',      screen: 'start'  },
  { name: 'explore',     screen: 'explore' },
  { name: 'exploreCon',  screen: 'explore', prefix: 'explore/' },
  // The constellation viewer, on a screen of its own. It used to declare the identify
  // screen and write a pre-answered one-question lesson session to borrow the reveal —
  // and while that screen was still called `quiz`, currentScreen() === 'quiz' was then
  // true in a place that is not a quiz (#73, and the rename that followed in #78).
  { name: 'view',        screen: 'view',    prefix: 'view/' },
  { name: 'lesson',      screen: null     },
  { name: 'result',      screen: 'result',  transient: true },
  { name: 'settings',    screen: 'settings' },
  { name: 'calibration', screen: null     },
];

const HOME = 'course';

// ── Pure: hash → route ──────────────────────────────────────────────────────
// Returns { name, param, screen, transient, hash }, or null when the hash names no
// route (the caller redirects). An empty hash is the course home.
function parseRoute(hash) {
  const h = _norm(hash);
  for (const r of ROUTES) {
    if (!r.prefix && h === r.name) return _route(r, null, h);
    if (r.prefix && h.startsWith(r.prefix)) {
      const param = h.slice(r.prefix.length);
      if (param) return _route(r, param, h);
    }
  }
  return null;
}

function _route(row, param, hash) {
  return { name: row.name, param, screen: row.screen || null, transient: !!row.transient, hash };
}

// A hash as the router stores it: no leading '#', and an empty one is the home route.
function _norm(hash) {
  return String(hash == null ? '' : hash).replace(/^#/, '') || HOME;
}

// ── Injected ports ──────────────────────────────────────────────────────────
let _history = null;    // { push(hash), replace(hash) }
let _setScreen = null;  // (screenName) => void
let _actions = {};      // { routeName: (param) => void }
let _exits = {};        // { routeName: () => void } — fired when the route is left
let _detours = {};      // { routeName: (param) => void } — how that route comes back

// ── Live state ──────────────────────────────────────────────────────────────
let _route_ = null;     // the current route value
let _screen = null;     // the screen currently active
let _detour = null;     // { route, resume, departed } while a detour is in flight

function initRouter({ history, setScreen, actions, exits, detours } = {}) {
  _history = history;
  _setScreen = setScreen;
  _actions = actions || {};
  _exits = exits || {};
  _detours = detours || {};
  _route_ = null;
  _screen = null;
  _detour = null;
}

function currentRoute() { return _route_; }
function currentScreen() { return _screen; }

// The only writer of the active screen — which is what lets currentScreen() be
// trusted, including on flow-owned routes that call this as they advance.
function showScreen(name) {
  _screen = name;
  _setScreen(name);
}

// ── Entering ────────────────────────────────────────────────────────────────
// navigate: an in-app navigation. Writes history, then enters. Navigating to the
// hash already showing replaces instead of pushing (so tapping the gear twice does
// not stack duplicate entries) but still runs the enter action.
// `opts.replace` overwrites the current entry instead of adding one — for a
// destination that supersedes where it came from. Ending a lesson uses it: the
// spent #lesson entry must not survive one Back away from the result screen,
// because resolving it would start a fresh lesson over the score just shown.
function navigate(hash, opts = {}) {
  const h = _norm(hash);
  const same = _route_ && _route_.hash === h;
  _history[same || opts.replace ? 'replace' : 'push'](h);
  _enter(h, true);
}

// enterRoute: an entry the app did not initiate — the boot hash or a popstate.
// `opts.write === 'replace'` writes the resolved hash back (boot, so that hash and
// screen agree from the first paint); popstate passes nothing and writes nothing.
function enterRoute(hash, opts = {}) {
  _enter(_norm(hash), false, opts.write);
}

function _enter(hash, inApp, write) {
  const route = parseRoute(hash);
  // A meaningless hash, or a transient route reached from outside the app (a
  // reload, a bookmark), resolves to the home route by REPLACE — a dead URL must
  // not leave a history entry for the back button to return to.
  if (!route || (route.transient && !inApp)) {
    _history.replace(HOME);
    _apply(parseRoute(HOME));
    return;
  }
  if (write === 'replace') _history.replace(hash);
  _apply(route);
}

// ── Detours ─────────────────────────────────────────────────────────────────
// A navigation that means to come back. beginDetour records the route being left
// plus a thunk that re-renders it; the departure that follows is not a departure,
// so the route's exit action does not fire and nothing needs saving and restoring.
// endDetour puts the hash back and runs the thunk — it deliberately does NOT re-run
// the enter action, because re-entering a lesson would try to resume from storage
// that a level check never wrote.
function beginDetour(resume) {
  _detour = { route: _route_, resume, departed: false };
}

// Start a detour back to wherever we are, if this is a place that comes back. Which
// routes do, and what coming back means for each, is declared once at boot in the
// `detours` table — beside the enter and exit actions, because it is the same kind of
// fact about a route.
//
// An entry is asked for a resume thunk and may answer null, meaning "not from here,
// not now". A flow-owned route needs that: a lesson or level check answers with whatever
// question is on display, of either kind, and answers null when the flow is showing
// something that is not a question at all — the level check's offer and payoff panels.
// A route with no entry at all never comes back: the explorer.
//
// This replaces callers deciding for themselves by asking which SCREEN was showing, a
// question that was wrong twice over. It could not tell a lesson question from the
// constellation viewer, which borrowed the identify screen (issues #69, #74). And it read
// "not the identify screen" as "no question here", which is false for a find question —
// the surface a quiz renders a find question on is the explorer, and that stranded the
// learner outside their own quiz (issues #75, #76).
function beginDetourFromRoute() {
  const route = _route_;
  const make = route && _detours[route.name];
  const resume = make && make(route.param);
  if (!resume) return false;
  beginDetour(resume);
  return true;
}

function inDetour() { return !!_detour; }

function endDetour() {
  if (!_detour) return;
  const { route, resume } = _detour;
  _detour = null;
  if (route) {
    _history.replace(route.hash);
    _route_ = route;
  }
  if (resume) resume();
}

// Any navigation other than the departure abandons the detour: drop it, and fire
// the exit action the departure deferred (unless we happen to be arriving back at
// the route we left, which is not a departure either).
// Returns true when this navigation IS the detour's departure — the one navigation
// that must not count as leaving the route it came from.
function _detourCheck(next) {
  if (!_detour) return false;
  if (!_detour.departed) { _detour.departed = true; return true; }
  const origin = _detour.route;
  _detour = null;
  if (origin && origin.name !== next.name) {
    const exit = _exits[origin.name];
    if (exit) exit();
  }
  return false;
}

function _apply(route) {
  const departing = _detourCheck(route);
  if (!departing) _leave(route);
  _route_ = route;
  // The declared screen goes up BEFORE the enter action runs: the constellation
  // viewer measures its picture, and an inactive screen has no layout.
  if (route.screen) showScreen(route.screen);
  const action = _actions[route.name];
  if (action) action(route.param);
}

// Leaving a route fires its exit action — the explicit form of "this navigation is
// a departure", which is what lets the level check clear its flag on the way out
// instead of defensively on every route change.
function _leave(next) {
  const prev = _route_;
  if (!prev || prev.name === next.name) return;
  const exit = _exits[prev.name];
  if (exit) exit();
}
