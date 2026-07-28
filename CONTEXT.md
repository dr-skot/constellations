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
