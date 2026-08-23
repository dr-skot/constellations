# Domain Model — constellations

Ubiquitous language for this codebase. Use these terms in code, comments, and reviews.

## Projection

- **Camera** — a value built by `makeCamera(P, up, fov, W, H)` (js/projection.js). Fixes a
  view centre `P` (unit vector), an `up` vector (re-orthogonalized to `P`), a field of view
  `fov` (degrees, full width), and a canvas size `W×H`. Presents one small interface over the
  rolled TAN (gnomonic) projection: `project(vec)`, `projectStars(stars)`, `unproject(px,py)`,
  plus the derived frame (`right`, `up`, `center`, `tanHalfFov`) the WebGL shader is fed from.
  The orthonormal frame and scale are computed once per Camera, not per call. Replaced the
  earlier `projectStarsCamera` / `vecToPixel` / `pixelToVec` trio (same math, one home).

- **facing** — the scalar returned on every projected point: the cosine of the angle between
  the view centre and the point. `facing > 0` means the point is in front of the camera;
  `facing ≤ 0` means it is more than 90° away (behind), and its pixel coords are a **phantom**
  (dividing by a negative `facing` flips signs and can land off-screen points on screen).
  Always guard drawing on `facing > 0`. (Formerly the opaque `d`.)

- **tanHalfFov(fov)** — the single sensitive scale atom, `tan(fov·π/360)`. Pixel scale is
  `(W/2)/tanHalfFov(fov)`; the shader consumes `tanHalfFov` directly. The wrong small-angle
  form `W/(fov·π/180)` once shipped — keeping the half-angle in one place prevents recurrence.

- **north-up projection** — `projectStarsTAN` / `pixelToRADec` project a fixed image centred on
  a constellation with north up; roll is applied downstream by the identify screen's canvas via
  `ctx.rotate`.
  Deliberately separate from the **Camera** (which bakes roll into `up`). See ADR-0001.

## Scheduling

- **planLesson** — the pure lesson planner built in `js/lesson.js`:
  `planLesson(exposure, catalog, bounds, rng, now, log?) → {label, questions}`. Given a snapshot
  of the learner's **exposure**, the constellation **catalog** (`C`), the boundary table
  (`BOUNDS`), a randomness source `rng` (`() → [0,1)`), and the clock reading `now`, it decides
  the next 12-question lesson: which constellations to review (by **heat**), which to introduce
  (queue-depth gated), and the difficulty knobs. Deterministic in its inputs — same
  `(exposure, rng, now)` yields the same lesson. `generateNextLesson()` in course.js is the thin
  impure adapter that supplies `loadExposure()`, `C`, `BOUNDS`, `Math.random`, `Date.now()`,
  `console`. The optional `log` sink (`{log, table}`, default no-ops) carries the debug dumps so
  the pure core stays silent under test.
  **Anti-repeat invariant** (issue #17): the emitted 12 questions never place the same
  constellation on two consecutive slots, and no constellation appears more than `ceil(12 / D)`
  times, where `D` is the count of distinct constellations the lesson draws on. With `D ≥ 12` that
  cap is 1 (no repeats); a smaller pool yields the minimum, evenly-spaced repeats — each repeat
  re-rolled to a possibly-different tier — instead of clones in a row. The only exception is the
  degenerate `D = 1`, where adjacency is unavoidable. Enforced by seeding one question per
  constellation, filling to 12 with capped repeats, then ordering with greedy most-remaining-not-
  previous spacing.

- **exposure** — the per-constellation practice record (`{abbr: {tierKey: {seen, correct,
  lastSeen}}}`), owned by `js/exposure.js`. The input planLesson reads; never a global it
  reaches for.

  It is the only thing this app stores that it cannot regenerate — a lesson, a reveal, a
  guide position all rebuild from the catalog; what somebody has practised exists nowhere
  else. Six verbs: `loadExposure()`, `recordSeen(abbr, tierKey)`,
  `recordCorrect(abbr, tierKey)`, `updateExposure(mutate)`, `resetExposure()`, and the pure
  `exposureIsEmpty(record)`. `initExposure({ store })` swaps the store; it **defaults to
  `localStorage`**, unlike `guideStart`'s roll or `prepareGuide`'s origin, which are
  required — there any default was wrong, here the default is the real store.

  **Saving is internal by convention.** `_saveExposure` is underscore-marked, not hidden —
  these are classic scripts in one global scope and nothing enforces it. The convention is
  worth keeping because a caller that does `const e = loadExposure(); … ; _saveExposure(e)`
  holds the record across whatever sits between those lines, and any write in that gap is
  silently overwritten by the stale copy. `updateExposure(mutate)` exists so the read and
  the write cannot be separated. Before this module, "Reset all progress" reached past
  everything to `localStorage.removeItem('con-exposure')`; `resetExposure()` replaced that,
  and no caller now names the key.

  Two behaviours worth knowing before changing anything here:

  - **The v1→v2 fold runs on read and persists as it goes** — a write inside a getter, kept
    deliberately. Migrating in memory only would re-fold on every load until the learner
    happened to answer something, and leave the old 16-tier keys in their browser
    indefinitely. A consequence: `resetExposure()` removes the key, and the next read puts
    it back holding `{_v2: true}`, because reading an absent record migrates `{}`.
  - **`recordSeen` stamps `lastSeen`; `recordCorrect` does not.** **heat** decays from
    `lastSeen`, and the level check credits `correct` with no `lastSeen` on purpose so
    seeded constellations stay hot in the review queue. A `recordCorrect` that stamped it
    would quietly cool them.

  Deliberately not owned: `applyCalibrationSeed` and `calibrationSeedTargets` stay in
  `js/calibration.js`. Which constellations `D*` credits is level-check knowledge, and a
  record that stores progress has no business knowing what `D*` is —
  `seedExposureFromCalibration` is one line over `updateExposure`, so the load-modify-save
  belongs to the record while the rule belongs to the level check.

- **heat** — a constellation's review priority: staleness (time since `lastSeen`, exp. rise over
  a 4h half-life) weighted by tier urgency, plus jitter. Hotter = more overdue → sorted first
  into the review pool.

- **tier** — one rung of the 7-step `TIER_SPECS` ladder (identify/diagram → find/photo-nb).
  A tier is passed at 1+ correct; the first unpassed tier is the **frontier**.

- **level check / calibration** — the optional up-front identification quiz (~8 probes, one
  per `diff` band) that seeds a returning learner's **exposure** so they skip the
  one-new-per-lesson introduction grind. It hands off to the normal adaptive **planLesson** —
  no parallel scheduler. Pure scoring + seeding core in `js/calibration.js`
  (`computeDStar` + `applyCalibrationSeed`); `seedExposureFromCalibration(dStar)` is the impure
  load→seed→save adapter. Beginners can skip it (`D* = 0`, no seeding) and start from zero.

- **known-difficulty threshold `D*`** — the calibration result: the hardest `diff` band (0–8)
  the learner reliably identifies, scored by `computeDStar` as the **best separator** —
  `argmin` over `b∈0..8` of `(misses in bands ≤ b) + (hits in bands > b)`, ties broken toward
  the lower (conservative) `b`. `0` ⇒ start at zero; `8` ⇒ credit all bands. Seeding then credits
  `identify/diagram` (upward-merge to ≥1, `lastSeen` deliberately omitted so seeded cons stay
  hot) for every renderable constellation with `diff ≤ D*`, and nothing higher up the ladder.

## Session

- **run** — which of the two things the learner is doing, as one value on the session:
  `session.run` is `RUN_LESSON`, `RUN_LEVEL_CHECK`, or `RUN_NONE`, and `isLesson(session)` /
  `isLevelCheck(session)` (js/quiz.js) are the two questions the app asks of it. A run is what
  a **quiz** is *for*: it decides whether an ask records an **exposure**, whether the session
  persists as a resumable **lesson session**, whether Previous exists, what the score slot
  says, and what a reveal's **link depth** is.

  It replaced two fields holding the same fact in halves — `session.calibration` and
  `session.lessonIdx` (never an index: read twice, both as `== null`). Every writer had to set
  both in agreement, and nothing enforced it; setting one and forgetting the other made a
  session that was a lesson and a level check at once, which fails silently and expensively —
  a level check that records exposures overwrites the learner's record before `D*` has
  measured them. One field makes that unrepresentable rather than merely unwritten (#92).

  **Starting a run is a plain assignment, deliberately.** Unlike `askQuestion`, which is a
  transition with a rule, a run has no rule beyond being one value at a time, and a setter
  that only assigns is noise. The one place that guards is the **level check**'s **exit
  action**, which ends the run *only if* the run is the level check — while the fact lived in
  two fields that exit cleared one of them and so could not end a lesson even in principle,
  and the offer panel is reachable mid-lesson from the course map and Settings.

  Not persisted: the **lesson session** payload carries no run, because only a lesson is ever
  written and resuming is what makes the restored session a lesson. That is why `#92` moved no
  payload version.

- **quiz** — a sequence of **questions** put to the learner one at a time, carrying a score and
  a progress readout. One of the things the learner can be doing, alongside free explore and the
  constellation viewer. A **lesson** is a quiz of 12 questions chosen by **planLesson**; the
  **level check** is a quiz of 8 probes that is not a lesson. Those are the only two — the
  explorer once had a "Find It" practice quiz of its own, but its entry point was replaced by
  the constellation search in March 2026 and the rest of it was deleted in #92.

- **question** — one item of a quiz, of exactly two kinds. An **identify question** shows a
  figure and asks for its name (by choice buttons or autocomplete). A **find question** shows
  the sky and asks the learner to tap a named constellation in it. Both are quiz questions:
  they differ in what they ask and which **screen** renders them, not in whether they belong to
  the quiz. `q.type` is `'identify'` or `'find'`, and the **tier** ladder runs from
  `identify/diagram` to `find/photo-nb` across both kinds.

  **Never use "quiz" to mean "identify question".** The two words sit on different axes: *quiz*
  says what the learner is doing, *identify* says what this question asks. The screen that renders
  identify questions was named `quiz` until #78, which is what let `currentScreen() === 'quiz'`
  read as "is this a quiz question?" when it only ever meant "is this an identify question?". That
  misreading is the whole of issue #75: the finding-guide return asked it, got "no" for a find
  question, and stranded the learner outside their own quiz. The surface is now `#screen-identify`
  and `showScreen('identify')`; `js/quiz.js` and `css/quiz.css` keep their names, because each
  holds quiz-level things too.

- **link depth** — how far a **question**'s reveal may take the learner: at most one step, and
  which step is a property of the question kind. `conLabel(con, { link })` in `js/render.js`
  takes it as an argument rather than reading a global — `false` for a **level check** probe
  (plain text, no anchor at all: a placement test is not an opportunity to learn), `'blurb'` for
  an **identify question** (the modal with the blurb and no onward actions, so closing it is the
  only exit), `'guide'` for a **find question** (the **finding guide** for the right answer,
  opened directly — no modal in between), and `'full'` everywhere outside a question, which is
  the default and is what the **constellation viewer** keeps. The mode rides on the anchor as
  `data-link`, because the click is handled by delegation in `js/main.js` long after the string
  was built. Before #64 the chain was unbounded: caption → modal → guide → the fully interactive
  explorer, several levels away from a lesson in progress.

- **question state** — a question is `unasked → asked → answered`, one value carried on the
  question itself (`q.state`, `js/quiz.js`). It replaced three flags that already disagreed:
  `session.answered` (identify path only, and stale while a find question was up, because it
  was assigned below the find early-return), `history[idx] == null` (which could not tell
  *never shown* from *shown, not answered*), and `explore.quiz.answered`. **`recordSeen` fires
  on the transition into `asked`** — `askQuestion(q)` returns true only for that transition, so
  a reload mid-question or a step back with Previous cannot record a second **exposure**. The
  old guard asked "no answer yet", which is true on every one of those renders (#77).
  `explore.quiz.answered` survives as the explorer's own **projection** of that state — read by
  the draw pass (`resolveDisplayFlags`) and the click/drag guards, which have no question in
  reach — never as an independent copy. It used to survive for a second reason as well, that the
  explorer's practice quiz had nothing else to keep it in; that quiz is gone (#92).

- **lesson session** — the in-flight lesson: the `session` object (questions, idx, correct,
  history, lessonLabel, and the **run** — no `answered`, see **question state**) plus the two
  reveal-toggle states `revState` (identify questions) and `eqRevState` (the explorer, so
  find questions). Persisted to `sessionStorage['lesson-session']`
  so a page reload resumes mid-lesson. It belongs to lessons alone: the constellation viewer
  used to write a one-question session and mark it answered in order to borrow the reveal,
  which is what issue #73 removed.

## Navigation

The pipeline reads: *hash → **route** → **screen***. `js/screens.js` is the single owner;
`main.js` injects its impure half (a history port, the `setScreen` sink, one enter action per
route and their exit actions) once at boot, so the whole router runs under node
(`test/screens.js`). Before it, half the navigations wrote the hash and half did not — which is
why code elsewhere asked the DOM which screen was showing and why leaving-and-returning was
hand-rolled twice (spec #44).

- **route** — a place the learner can navigate to, named by a hash and declared in one table:
  `course`, `explore`, `explore/<abbr>`, `view/<abbr>`, `lesson`, `result`, `settings`,
  `calibration`. `parseRoute(hash)` is the pure decode (an empty hash is the course home; an
  unrecognized one is `null`, and the caller redirects). The table is also where hash `course`
  maps to screen id `start` — a mapping that used to live only inside an `if`.

- **screen** — one of the seven `.screen` elements. `showScreen` is the *only* writer of the
  active screen, which is what makes `currentScreen()` answerable without reading a CSS class.
  A route's declared screen is applied **before** its enter action runs: the constellation
  viewer measures its picture, and an inactive screen has no layout. The viewer has a screen
  of its own (#73); while it borrowed the identify screen — then still named `quiz` —
  `currentScreen() === 'quiz'` was true in a place that is not a quiz, which is what made the
  finding-guide return pick the wrong resume.

  A screen is a **rendering surface, not a mode**. The `explore` screen hosts free explore *and*
  a quiz's find questions; the identify screen hosts a quiz's identify questions *and* **level
  check** probes. So asking which screen is showing never answers what the learner is doing, and
  code that wants the latter must ask the flow. Both bugs that came of forgetting this — #69 and
  #75 — were `currentScreen()` standing in for a fact it does not carry.

- **detour** — see Navigation below. Which routes come back, and how, is a per-route entry
  injected at boot beside the enter and exit actions; an entry may decline from where the
  flow currently is (the **level check** showing its offer or payoff has no question to
  re-render). An entry answers from the flow, never from the surface: a **quiz** comes back
  to whichever **question** is on display, and both kinds come back the same way, because
  the question renderer picks its own screen (#76).

- **flow-owned route** — a route that declares no screen, because the flow picks one as it
  advances: `lesson` renders an identify question on the identify screen and a find question on
  the explorer, and `calibration` shows its panels for the offer and payoff but the identify
  screen for the probes. The route does not change when the flow switches screens — a lesson is
  one quiz throughout, whichever surface each question needs.

- **transient route** — a route whose data lives only in memory, so it is enterable only from
  inside the app. `result` is the only one: a finished lesson is gone after a reload, so a cold
  entry redirects to the course home rather than resolving `#lesson`, failing to resume, and
  starting a fresh lesson over the score.

- **detour** — a navigation that means to come back. `beginDetour(resume)` records the route
  being left plus a thunk that re-renders it; `endDetour()` restores the hash by replace and
  runs the thunk, deliberately **not** re-running the enter action (re-entering `lesson` would
  try to resume from storage a level check never wrote). The departure is not a departure, so
  the departed route's **exit action** does not fire — which is why the finding guide launched
  from a probe needs no saving and restoring of the level-check flag. Navigating on instead
  cancels the detour and fires the exit action it deferred. `detourOrigin()` reads the route
  one will return to, which is how a control can *name* where it goes rather than saying
  "Back" (see **exit label**).

- **exit label** — what the finding guide's exit control says. `guideExitLabel`
  (`js/guide-exit-label.js`) is a pure function of the **detour** in flight and whether a
  lesson's find question is waiting underneath: the destination gets named where there is one
  ("← Back to lesson", "← Back to level check", "← Back to Orion", or "← Back to the figure"
  for a viewer detour whose constellation cannot be named), and the action gets named where
  there isn't ("Close guide" from free explore — the learner is already looking at the
  explorer, so nothing is being retraced). The label belongs to the guide session, not the
  step, and travels as `guideStart`'s `exitLabel` option (#66).

- **exit action** — what leaving a route means. The level check clears its run flag here, so a
  probe exit via a breadcrumb or the gear can't leak the flag into a later lesson. It replaced
  a preamble that cleared the flag on *every* route change, because the old dispatcher could
  not tell a departure from an arrival.

Redirects — an unknown hash, a transient route entered cold — **replace** rather than push, so
a dead URL leaves no history entry. Navigating to the hash already showing replaces too, but
still runs the enter action.

## Diagram sources

- **diagram source** — a set of constellation stick-figures (which stars, which connecting
  lines). Four are registered in `js/diagram-sources.js`: **IAU** (the master catalog `C`, the
  default), **Rey** (`REY`), **Stellarium** (`SC`), **Ford** (`FORD`). They share the catalog
  schema (`{name, abbr, hem, diff, ra, dec, fov, stars[], lines[]}`) but differ in the `stars`
  and `lines` that make up the drawn figure. IAU is authoritative for everything else.

- **diagramFor(con, sourceKey)** — pure accessor: the figure to *draw* for `con` under the
  selected source. Returns the alternate entry (looked up by abbr) or falls back to `con` when
  the source lacks it or the key is unknown. Swaps **only the drawn stars+lines** — framing
  (ra/dec/fov comes from `con`=`C`), answer-checking, bounds, art, and exposure all stay keyed
  to `C`, so choosing a figure style is purely visual. `diagramSource` is the app-global selected
  key (persisted under `ex-diagramSource`); both the explorer draw path and the identify screen's
  `renderCanvas` read it. `_diagFor`/`_diagSource`/`_diagSources` in explore.js were the earlier,
  explore-only, never-wired version this replaced.

- **sessionToJSON / sessionFromJSON** — the pure round-trip in `js/lesson-session.js`:
  `sessionToJSON(session, revState, eqRevState) → payload` and
  `sessionFromJSON(payload, catalog) → restored | null`. The single home for the con↔abbr
  conversion (a question stores `con.abbr` on disk, resolves it against the catalog on load) and
  the optional per-question fields (distanceLevel, noBounds, rotation, startP/startFov, choices,
  and the **question state**). `sessionFromJSON` returns `null` when the payload is unusable
  (a version outside `LESSON_SESSION_V_MIN`…`LESSON_SESSION_V`, missing lessonLabel, or any abbr
  that doesn't resolve). The payload is at **v3**; a **v2 payload migrates rather than being
  discarded** — `asked` is inferred from the first-ask side effects v2 already persisted by
  accident (`q.rotation` for identify, `q.startP` for find), and an answer record outranks both.
  Only a non-default state is written, so a missing `state` key means `unasked` and the
  round-trip stays a fixed point. Pure obj↔obj: sessionStorage and the DOM
  toggle-group application stay in the quiz.js adapter (`saveLessonSession`/`tryResumeLesson`).

## Finding guides

- **guide source** — the single home for loading, preparing and validating a finding
  guide (`js/guide-source.js`, spec #82). Five verbs:
  `initGuideSource({ fetch })`, `warmGuideSource()`, `hasGuide(con) → Promise<boolean>`,
  `prepareGuide(con, { origin }) → Promise<{ steps, roll, problems } | null>`, and
  `skyCatalog() → Promise<catalog>`. Behind it: the two stamped fetches and their shared
  cache, the defensive step copy, the `random` fill, the roll, and the schema gate.

  It takes a **con**, never a name, because the guide JSON is keyed by *display name* — an
  exact string match, `Boötes` diaeresis included — and that key was the one piece of
  knowledge every caller had to share with the data file. Owning the join is the depth:
  no caller knows how guides are keyed, so re-keying the JSON by abbr would be a one-line
  change here and nowhere else.

  `origin` is a value the caller passes, never something the module reaches for. "Where is
  the learner looking?" is a question only the host can answer, and the two hosts answer it
  differently on purpose: in-app it is the current view, so a guide opens where the learner
  already is; `find-help.html` has no prior view, so a random patch of sky stands in. Not
  reaching for `explore.P` is also what puts the whole module under node.

  **`null` and a rejection mean different things.** `null` is "no guide is written for this
  constellation"; a rejection is "the load failed". `find-help.html` has always shown two
  different messages for them. A missing `origin` **throws** rather than rejecting, for the
  same reason: calling the function wrong is not a network problem and must not reach a
  learner as one. (Every guide's opener is a `random` step with no coordinates of its own,
  so a missing origin would otherwise aim the camera at `NaN` in silence.)

  `fetch` is injected at `initGuideSource` — the `initRouter` / `planLesson` precedent —
  which is what forced the warm-up to become an explicit `warmGuideSource()`. That is the
  better shape anyway: a module that opens a network connection merely by being on the page
  cannot be quietly loaded by a test or a tool.

- **step** — one panel of a finding guide (88 guides, 338 steps). A step declares two
  independent things: **where to point** (`ra`/`dec`/`fov`/`rotation`, or `random` for the
  opening step) and **what to show**. They differ in how they transition — the camera is
  **tweened** between steps by `guideAnimateTo`, the display is **intersected** — and that
  difference is why the seam sits between them.

  Both halves now have an owner, and the 15-field schema splits along exactly that line:
  the **step display** owns the nine that say what to show, the **guide source** owns
  `ra`/`dec`/`fov`/`rotation`/`random` and `title`/`caption`. Each reports `problems` in the
  same idiom, so the data draws one kind of complaint rather than two, and
  `test/guide-source.js` walks the whole corpus asking both. Before #82 the second half was
  owned by nobody: a typo in a guide-level `rotation` was silently ignored and flew every
  step of that guide at the wrong roll.

  Exactly one step per guide is `random` — the opener, 88 of 88 — and only two guides
  (Orion, Ursa Major) set a guide-level `rotation`. 270 of the 338 steps declare no
  rotation of their own and fall back to the guide's **roll**.

- **roll** — the camera rotation a guide's step falls back to when it declares no
  `rotation` of its own: north-up at the constellation, plus the guide-level `rotation`
  where one is set. Computed by the **guide source** and passed to
  `guideStart(steps, catalog, { roll })`, where it is **required** — no default.

  It used to be read off `explore.R` at the instant `guideStart` was called, so every
  caller had to assign `explore.R` immediately beforehand or 270 of the 338 steps rolled
  wrong. That was an ordering contract between two modules written down nowhere, and it is
  why both hosts carried an identical roll stanza directly above their `guideStart` call —
  duplication that read as sloppiness and was actually a leaking seam. The parameter has no
  `?? explore.R` fallback on purpose: a fallback keeps the timing-dependent behaviour alive
  for whoever forgets, and forgetting is the failure being removed (#88).

- **step display** — what a step asks the explorer to show, as one value
  (`js/step-display.js`, pure). Built by `makeStepDisplay(step, catalog)`, the single
  conversion out of the guide JSON. Carries `layers` (`photo`/`diagram`/`bounds`/`art`/
  `names`, each `{on, only}` where `only` is an abbr allowlist or `null`), `lines` (guide
  lines with endpoints already resolved to ra/dec, keeping their raw name pair as
  identity), `marks` (kind-tagged: `circle`/`capsule`/`line`/`crosshair`/`precession`),
  and `problems` (unresolvable catalog ids and fields nothing reads — the data-integrity
  gate, asserted empty by `test/step-display.js`). The pipeline reads:
  *step → **step display** → **display flags** (sky canvas) + **marks** (annotation canvas)*.
  Complete-or-null: while a guide runs the value fully determines the layers and `exState`
  is not consulted; `null` means no guide. Replaced six tri-state override flags plus four
  `guideLines*` properties on the `explore` bus (spec #37).

- **overlays** — everything a step display turns on **except the photo**: the figure
  layers, the guide lines, and the marks. That is precisely what the Show/Hide overlays
  button removes and leaves. `hasOverlays(display)` is the query (button visibility);
  `displayWithoutOverlays(display)` is what the button produces. Asking the value replaced
  a hand-written list of field names that had already lost the precession circle.
  Deliberately *not* the name of the step display itself: the two senses cross — overlays
  exclude the photo, which the display carries, and the display carries marks the earlier
  boolean-flag group did not.

- **intersectDisplays(a, b)** — the step-transition carry-over: only what both steps have
  in common stays lit while the camera flies, so departing elements clear before the
  flight and arriving ones appear on landing. Layers meet at shared abbrs when both are
  filtered, otherwise the destination wins when the origin is on. Guide-line segments match
  on their name pair; marks match on `key` (the catalog id, else the entry serialized) —
  so a precession mark, which has no `key`, never survives a flight. Replaced
  `_guideIntersectSettings` / `_guideIntersectAnnotation` / `_intersectFilter`.

## Explore rendering

- **render scheduler** — the explorer's single frame owner (`js/render-scheduler.js`,
  `makeRenderScheduler({raf, cancel, draw, now})`). Nothing draws the sky directly: callers
  **request** a draw and the scheduler renders at most **one per frame**, so a 120Hz touch
  stream cannot outrun the renderer. `requestExploreDraw()` in explore.js is the app-wide
  entry point; the only direct `drawExplore()` call left is the scheduler's own. Four
  guarantees, pinned by `test/render-scheduler.js`: at most one draw per frame; **never zero
  draws for an outstanding request** (a dirty flag cleared at the wrong moment loses the last
  frame of a drag, leaving the sky one frame behind the finger); tickers run *before* the
  draw in the same frame; `cancel()` leaves no frame and no tickers. Replaced sixteen callers
  each drawing synchronously, plus two animation loops that owned frames of their own — a
  pinch during a north-arrow fade used to render the whole sky twice (issues #53, #55).

- **ticker** — an animation registered with the render scheduler via
  `addTicker(tick, done)`. `tick(now)` advances state only and returns `false` when finished;
  the scheduler then deregisters it and runs `done()` — **before** that frame's draw, so a
  goto flight's final snap to its exact target is what gets rendered rather than the last
  eased approximation. `removeTicker` deliberately does *not* run `done()`: removal means the
  animation was interrupted, and running an abandoned flight's completion would snap the
  camera to the target it was told to give up on. Every animation is now a ticker — the
  north-arrow fade, and both camera flights (issues #54, #58) — so the scheduler is the
  explorer's only frame owner with no exceptions.

- **camera flight** — a ticker that moves the camera: `animateGoTo` in explore.js, or
  `guideAnimateTo` in guide-renderer.js flying between finding-guide steps. Both go through
  `startCameraFlight(tick, done)`, and there is exactly **one** handle (`_cameraTicker`)
  because the camera has one flight — starting either kind stops the other, so a second
  variable could only ever hold null. `stopCameraAnimation()` is the abandon path (a new
  flight, a hand on the sky, a guide torn down mid-step) and skips `done` for the reason
  above; a flight aborting itself stands down through it rather than returning `false`.
  Registration being the handle is also what makes a flight cancellable from the moment it
  starts: the guide flight used to record its frame handle on every frame *except the
  first*, so grabbing the sky the instant a step began did nothing and it flew on (#58).

- **draw phases** — the per-layer timing hook in `js/draw-phases.js`
  (`beginDrawPhases`/`markDrawPhase`/`endDrawPhases`), marking the section boundaries
  `drawExplore` was already divided into. A phase runs from its mark to the next. Inert
  unless the perf probe installs a sink, so a normal run pays a null check per boundary.
  `makePhaseCollector({now, frames})` is the pure accumulator behind it (mean and max per
  phase over a rolling window, ranked most expensive first), tested by `test/draw-phases.js`;
  `perf/draw-probe.js` installs one under `?perf=1&draw=1` and reports to its own on-screen
  panel. Measures **main-thread CPU only** — `gl.drawElements` returns before the GPU has
  done the work, so the photo and art phases read near zero even when fill rate costs real
  time (issue #52).

- **display flags** — the discrete set of per-layer booleans that drive `drawExplore`'s passes:
  `showPhoto, showDiag, showStars, showLines, showBounds, showArt, showStarLabels, showConNames`
  plus `refMode` (`'always' | 'moving' | null`), the context flags `cm`/`isAnswered`, and the
  per-layer allowlists `diagramOnly, boundsOnly, artOnly, namesOnly` (`null` = every visible
  constellation). `resolveDisplayFlags(explore, exState, eqRevState)` in `js/explore.js` is the
  pure resolver: it decodes the three-way state — course mode (`explore.quiz.stageMode`, answered
  vs. not), the running guide's **step display** (`explore.stepDisplay`), and free-explore defaults
  (`exState`) — into that bundle. Returning the filters beside the flags is what keeps the draw
  passes from decoding the display a second time; before the step display existed, six loose bus
  properties were read here as booleans and re-read 460 lines later as allowlists.
  The per-frame alpha ramps (`_refAlpha`, `_compassAlpha`) that fade the reference guides stay
  inline in `drawExplore` next to their draw calls, since they depend on the animation value
  `explore._northAlpha`. Characterized by `test/display-flags.js`: 86 of the frozen truth table's
  103 scenarios replay byte-for-byte, and the 17 encoding partial overrides — unreachable under a
  complete-or-null display — are covered instead by a sweep against a verbatim transcription of the
  pre-refactor cascade.

- **strokePolyline(ctx, pts, close)** — the canvas primitive in `js/explore.js` for a projected
  polyline. Owns `beginPath` + the final `stroke`; lifts the pen wherever a point faces away from
  the camera (`facing <= 0`). A segment that straddles the near plane is **clipped** to the horizon
  via `clipToNear` so the line runs to the screen edge instead of dropping the crossing segment
  (issue #1). Callers set the stroke style beforehand and, for multi-ring shapes, call once per ring;
  `close` closes the final sub-path (the phototile debug outline). Used by the equator, Milky Way,
  boundary, quiz-highlight, and phototile passes.

- **clipToNear(a, b)** — perspective-correct screen point where the segment `a→b` crosses the near
  plane, evaluated at `facing = NEAR_EPS`. Both `x·facing` and `facing` are linear along the
  view-space chord (gnomonic projection maps that chord to a straight screen line), so it reproduces
  the projected crossing from the two projected endpoints alone. Backs strokePolyline's horizon clip.

- **black-point crush** — the photo layer is assembled from per-constellation square JPG crops
  (`img/<abbr>.jpg`), each carrying JPEG shadow-noise in its near-black background (values ~6–15)
  that reads as a blue-grey **quilt** once shadow gamma amplifies it. The photo fragment shader in
  `js/explore-gl.js` subtracts a floor and rescales — `rgb = max(rgb - uFloor, 0) / (1 - uFloor)` —
  crushing that noise to black while keeping real stars and nebulae. The floor is `PHOTO_BLACK_FLOOR
  = 12/255`, tuned against the π Orionis bow: high enough to clear the quilt, low enough to keep the
  faintest naked-eye stars as dim points rather than erasing them. Photo passes set it; the art layer
  draws with `uFloor = 0`. The crush resolves the quilt (issue #23); the faint straight tile-edge
  seams that remain are a separate, minor artifact left unaddressed.

## Label placement

The same "spiral-search-avoiding-boundaries" algorithm places a text label where it clears
constellation boundaries, in two coordinate frames. The shared machinery lives in `js/render.js`
alongside the geometry primitives it uses (`pointInPoly2D`, `edgesHitRect`).

- **fitLabelBox(cx, cy, hw, hh, { inside, outside, edges })** — the collision test: samples the
  label box's centre + 4 corners and requires every sample to lie inside the `inside` polygon
  (when given) and outside the `outside` polygon (when given), with the box rect crossing none of
  `edges`. Pure. The caller owns the bounds-shape test (canvas rect vs. circle) and any coordinate
  transform, passing already-transformed `cx,cy`.

- **searchLabelSpot(preScan, center, radii, valid)** — the search: tries each `preScan` point in
  order, then walks rings of 16 evenly-spaced angles at each radius in `radii` (given order) around
  `center`, returning the first `{x,y}` where `valid` holds, else `null`.

- **findNeighborLabelSpot(view, neighborPts, hint, box)** — places a neighbor's name in the
  rotated, circular reveal on the identify screen; lifted out of a closure that used to live
  inside `redrawReveal`.
  Pure (screen-space 2D in, point out): `view = { cx, cy, R, cosA, sinA, currentPts, edges }` is the
  per-reveal geometry, built once and passed per neighbor. Characterized by `test/neighbor-label.js`
  against a golden captured from the pre-refactor closure.

- **conNamePosition** (`js/explore.js`) places a constellation's *own* name in the explore view; it
  stays an impure adapter (camera projection, `measureText`, throttle cache, unprojection) wrapped
  around `searchLabelSpot` + `fitLabelBox`.

## View state

- **view state** — the core explore camera: position `P` (a unit-vector array), rotation `R`, and
  field of view `fov` (all on the `explore` bus). `P` is an array, so a saved copy must never share
  its reference with the live `explore.P`.

- **snapshotView(explore) / applyView(explore, snap)** (`js/explore.js`) — the copy-safe pair that
  is the single home for that discipline. `snapshotView` returns `{ P: explore.P.slice(), R, fov }`;
  `applyView` writes them back, copying `P` again (`explore.P = snap.P.slice()`). Every *in-memory*
  save/restore of the view routes through them — lesson history (`session.history[i].exploreState`),
  find-guide (`_guideSaved`), and the `q.startP`/`q.startFov` restore — so no restore can alias `P`.
  This fixed a latent bug: `course.js` used to restore `explore.P` without a copy (safe only because
  nothing mutates `P` in place — the contract these functions now enforce). Separate from the RA/Dec
  `sessionStorage` round-trip (`saveExploreState`/`restoreExploreState`), which serializes sky
  coordinates and rebuilds a fresh vector. Characterized by `test/view-snapshot.js`.
