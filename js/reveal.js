// js/reveal.js
// The reveal — what a constellation looks like when it is shown in full: the
// photograph or the generated sky, the artwork over it, the star figure and its
// stars, the boundary and its neighbour labels.
//
// Two activities show a reveal: a quiz question that has been answered, and the
// constellation viewer. They ask for the same picture from different states, so this
// module owns the DECISIONS and nothing else — which layer draws, over which
// background, at what rotation, in which star-figure set.
//
// Pure: no DOM, no globals, no lesson session. That is the point. The painter used
// to work these out inline by reading `revState`, `session.rotation`,
// `session.answered`, `settings.mode` and the app-global diagram source, which is
// why the viewer had to write a one-question lesson session and mark it answered
// before it could borrow the picture (issue #70). Loadable in node, and
// characterized against a transcription of the old inline cascade in
// test/reveal-flags.js — the same discipline as resolveDisplayFlags for the
// explorer.
//
// The two asynchronous facts arrive as inputs rather than being probed here: a
// photograph and an artwork both load late, and whether they have arrived is the
// caller's knowledge, not this module's.

function resolveReveal({ layers, mode, rotation, source, photoReady, artReady }) {
  const showPhoto = !!layers.photo;
  const showDiag  = !!layers.diagram;

  return {
    rotation: rotation || 0,

    // The photograph draws only once it has actually loaded; until then the reveal
    // falls back to the generated sky, star-field styled in stars mode.
    background: (showPhoto && photoReady) ? 'photo' : (mode === 'stars' ? 'stars' : 'gradient'),

    showLines: showDiag,

    // Deliberately the photo TOGGLE, not the background that resulted. A learner who
    // has the photograph on while it is still loading sees neither the photograph nor
    // the stars — the pre-extraction behaviour, preserved because changing it would
    // change what a reveal looks like, which this work is not for.
    showStars: !showPhoto || showDiag,

    // Artwork needs the toggle AND the image; a constellation with no artwork simply
    // never becomes ready.
    showArt: !!layers.art && !!artReady,

    showBounds: !!layers.boundary,

    // The star figure's labels belong to the figure.
    showStarLabels: showDiag,

    source,
  };
}
