// js/reveal-panel.js
// The panel that shows one constellation: the circular picture — photograph or
// generated sky, artwork, star figure, boundary — its artwork credit, and the layer
// toggles that decide what of that is drawn.
//
// A component, in the same sense as createToggleGroup: it builds its own elements
// into the hosts it is given and is addressed through the handle it returns. Nothing
// outside reaches for its parts by id, which is what lets a second one exist — the
// constellation viewer mounts its own rather than borrowing the quiz's by pretending
// to be a pre-answered question (issue #70).
//
// Two hosts, not one. The picture and the toggles are not adjacent: the toggles share
// a layout slot with the question's label, so that revealing an answer does not shift
// the page. Handing the component both hosts keeps that arrangement the page's
// business rather than the component's.
//
// The DECISIONS about what to draw live in js/reveal.js and the PAINTING in
// js/render.js. This owns the elements, the two late-arriving images, and which
// reveal is currently on screen.

function createRevealPanel({ picture, controls, layers, onLayerChange } = {}) {
  // ── The picture ────────────────────────────────────────────────────────────
  const area   = document.createElement('div');   area.className   = 'con-canvas-area';
  const wrap   = document.createElement('div');   wrap.className   = 'con-canvas-wrap';
  const canvas = document.createElement('canvas'); canvas.className = 'con-canvas';
  const box    = document.createElement('div');   box.className    = 'con-photo-box';
  const img    = document.createElement('img');   img.className    = 'con-photo';
  const msg    = document.createElement('div');   msg.className    = 'con-photo-msg';
  const credit = document.createElement('div');   credit.className = 'con-art-credit';
  img.alt = 'Night sky photograph';
  msg.textContent = 'Loading DSS sky photograph…';
  box.append(img, msg);
  wrap.append(canvas, box);
  area.append(wrap, credit);
  if (picture) picture.appendChild(area);

  // ── The toggles ────────────────────────────────────────────────────────────
  // The panel does not own which layers are on: the quiz keeps that in its lesson
  // session and the viewer will keep its own (issue #73). It owns the buttons.
  let toggles = null;
  if (controls) {
    const el = document.createElement('div');
    el.className = 'con-toggles toggle-group';
    controls.appendChild(el);
    toggles = createToggleGroup(el, {
      buttons: [
        { label: 'Photo',   value: 'photo',    on: layers ? !!layers.photo    : true },
        { label: 'Diagram', value: 'diagram',  on: layers ? !!layers.diagram  : true },
        { label: 'Art',     value: 'art',      on: layers ? !!layers.art      : true },
        { label: 'Bounds',  value: 'boundary', on: layers ? !!layers.boundary : true },
      ],
      onChange(value, on) { if (onLayerChange) onLayerChange(value, on); },
    });
    toggles.el = el;
  }

  // The reveal on screen, or null. A photograph and an artwork both load late and
  // then ask to be drawn; what they must not do is paint over whatever replaced them.
  // Per panel, which is what keeps two panels from answering for each other.
  let shown = null;

  const panel = {
    el: area, canvas, wrap,

    // ── Sizing ───────────────────────────────────────────────────────────────
    // The wrap is what the page lays out; the canvas follows it at device scale.
    resize() {
      const sz = wrap.offsetWidth;
      const px = sz * displayScale();
      sizeCanvas(canvas, px, px);
      return px;
    },
    circular(on) { wrap.classList.toggle('con-circle', on !== false); },

    // ── The unanswered question ──────────────────────────────────────────────
    // Not a reveal: no layers, no artwork, no boundary — and it clears the record,
    // so an image that arrives afterwards cannot paint a reveal over it.
    showFigure(con, { mode, rotation } = {}) {
      shown = null;
      if (mode === 'photo') showPhotoMode(con, rotation, panel);
      else renderCanvas(canvas, con, mode, false, rotation);
    },

    // ── The reveal ───────────────────────────────────────────────────────────
    showReveal(con, intent) {
      // Photo-mode questions hide the canvas behind the photo box; a reveal paints
      // the photograph into the canvas instead, so the box gets out of the way.
      if (intent.mode === 'photo') {
        box.classList.remove('show');
        img.classList.remove('show');
        img.style.transform = '';
        canvas.style.display = 'block';
      }
      // Offer a toggle only for a layer this constellation actually has.
      if (toggles) {
        for (const b of toggles.getButtons()) {
          if (b.dataset.value === 'art')      b.style.display = ART[artSrc(con.abbr)] ? '' : 'none';
          if (b.dataset.value === 'boundary') b.style.display = BOUNDS[con.abbr] ? '' : 'none';
        }
        toggles.el.classList.add('show');
      }
      if (img.dataset.abbr !== con.abbr) {
        img.dataset.abbr = con.abbr;
        img.onload = () => { if (panel.showing(con)) panel.redraw(shown.intent); };
        img.src = photoUrl(con);
      }
      panel.redraw(intent, con);
      ensureArtLoaded(con, () => { if (panel.showing(con)) panel.redraw(shown.intent); });
    },

    // Repaint the reveal on screen with a (possibly changed) intent — a toggle moved,
    // an image landed, the figure set changed.
    redraw(intent, con) {
      const c = con || (shown && shown.con);
      if (!c) return;
      shown = { con: c, intent };
      paintReveal({ canvas, photoImg: img, creditEl: credit }, c, intent);
    },

    showing(con) { return !!shown && shown.con === con; },
    shownIntent() { return shown && shown.intent; },

    // ── Between questions ────────────────────────────────────────────────────
    clear() {
      shown = null;
      credit.innerHTML = '';
      if (toggles) toggles.el.classList.remove('show');
    },
    setLayer(value, on) { if (toggles) toggles.setValue(value, on); },

    // Photo-mode questions drive these directly; the panel keeps the elements.
    photoBox: box, photoImg: img, photoMsg: msg, creditEl: credit,
  };

  return panel;
}
