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
  a constellation with north up; roll is applied downstream by the quiz canvas via `ctx.rotate`.
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

- **exposure** — the per-constellation practice record (`{abbr: {tierKey: {seen, correct,
  lastSeen}}}`), persisted to localStorage by course.js. The input planLesson reads; never a
  global it reaches for.

- **heat** — a constellation's review priority: staleness (time since `lastSeen`, exp. rise over
  a 4h half-life) weighted by tier urgency, plus jitter. Hotter = more overdue → sorted first
  into the review pool.

- **tier** — one rung of the 7-step `TIER_SPECS` ladder (identify/diagram → find/photo-nb).
  A tier is passed at 1+ correct; the first unpassed tier is the **frontier**.

## Session

- **lesson session** — the in-flight run of a lesson: the `session` object (questions, idx,
  correct, answered, history, viewMode, lessonIdx/Label) plus the two reveal-toggle states
  `revState` (quiz) and `eqRevState` (explorer). Persisted to `sessionStorage['lesson-session']`
  so a page reload resumes mid-lesson.

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
  key (persisted under `ex-diagramSource`); both the explorer draw path and the quiz `renderCanvas`
  read it. `_diagFor`/`_diagSource`/`_diagSources` in explore.js were the earlier, explore-only,
  never-wired version this replaced.

- **sessionToJSON / sessionFromJSON** — the pure round-trip in `js/lesson-session.js`:
  `sessionToJSON(session, revState, eqRevState) → payload` and
  `sessionFromJSON(payload, catalog) → restored | null`. The single home for the con↔abbr
  conversion (a question stores `con.abbr` on disk, resolves it against the catalog on load) and
  the optional per-question fields (distanceLevel, noBounds, rotation, startP/startFov, choices).
  `sessionFromJSON` returns `null` when the payload is unusable (`_v` mismatch, missing
  lessonLabel, or any abbr that doesn't resolve). Pure obj↔obj: sessionStorage and the DOM
  toggle-group application stay in the quiz.js adapter (`saveLessonSession`/`tryResumeLesson`).
