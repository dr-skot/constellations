# ADR-0001: Camera is scoped to the explorer path; the north-up projection stays separate

Status: Accepted (2026-07-27)

> **Terminology note (2026-08-19, #78).** Where this record says "the quiz canvas" it means
> the canvas on the **identify screen** — the surface was named `quiz` when this was written
> and is `#screen-identify` now. The decision and its reasoning are unchanged; the body is
> left as accepted rather than rewritten. See CONTEXT.md for why the two words are not
> interchangeable.

## Context

`makeCamera` (js/projection.js) unified the rolled TAN projection used by the explorer,
replacing `projectStarsCamera` / `vecToPixel` / `pixelToVec` behind one deep interface and
giving the sensitive scale a single home (`tanHalfFov`). See CONTEXT.md for the vocabulary.

The obvious next step a future architecture review will suggest: fold the **north-up**
functions — `projectStarsTAN` and `pixelToRADec` — into the Camera too, so there is exactly
one projection module.

## Decision

Leave `projectStarsTAN` and `pixelToRADec` as separate north-up functions. The Camera is
scoped to the explorer's rolled-camera path. The only unification applied to the north-up
functions is that they now derive their scale from the shared `tanHalfFov`.

## Why (do not re-litigate without this in mind)

- The quiz canvas projects a fixed, north-up image and applies **roll downstream** with
  `ctx.rotate(angle)` + `rotateProj` (js/render.js:165, 323). This is a fundamentally
  different roll model from the Camera's (which bakes roll into the `up` vector).
- `projectStarsTAN` also feeds the art-anchor solve (render.js:210) and the WebGL art mesh
  (explore-gl.js), both of which depend on its north-up, `ctx.rotate`-based pipeline.
- Folding it in would mean rewriting that working, visually hand-tuned pipeline to a
  camera-`up` roll — high regression risk, low incremental payoff. The single-source-of-truth
  win for the sensitive formula is already captured via `tanHalfFov`.

## Consequences

- Two projection entry points coexist by design: `makeCamera` (rolled camera) and
  `projectStarsTAN`/`pixelToRADec` (north-up + downstream `ctx.rotate`).
- If the quiz canvas is ever migrated to a camera-`up` roll model, revisit this ADR — that
  migration is the precondition that would make folding the north-up path in worthwhile.
