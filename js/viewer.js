// js/viewer.js
// The constellation viewer: "just show me this one". Reached by naming a
// constellation on the course home, by the picker at the top of the viewer itself,
// or straight from the address as view/<abbr>.
//
// It has its own screen and its own state (issue #73). It used to have neither: it
// declared the identify screen, wrote a one-question LESSON SESSION, marked that question
// answered before the learner had seen anything — an answered question is what shows a
// REVEAL — and hid that screen's own parts with CSS. Every flow that later wanted the
// identify screen had to undo the disguise, Quit had to ask whether this "lesson" was
// really a viewer, and opening the viewer turned the Photo toggle off in the learner's
// lesson.
//
// None of that is here. The viewer mounts its own reveal panel, keeps its own layer
// choices, and writes nothing a quiz reads.

// The viewer's own layer choices. Deliberately NOT the identify screen's revState, and not part of
// the lesson session: studying one constellation and being questioned about others are
// different activities, and one must not silently reconfigure the other.
//
// The photograph starts off, which is how the viewer has always opened — it used to
// reach into the identify screen's toggles and switch it off on the way in, which is exactly the
// contamination this removes. The default is kept; only the reaching is gone.
const viewerLayers = { photo: false, diagram: true, art: true, boundary: true };

let _viewerPanel = null;
let _viewerCon = null;

function viewerPanel() {
  if (!_viewerPanel) {
    _viewerPanel = createRevealPanel({
      picture: document.getElementById('view-picture'),
      controls: document.getElementById('view-controls'),
      layers: viewerLayers,
      onLayerChange(value, on) {
        viewerLayers[value] = on;
        const redraw = () => _viewerPanel.redraw(viewerIntent());
        const img = _viewerPanel.photoImg;
        if (value === 'photo' && (!img.complete || img.naturalWidth === 0)) img.onload = redraw;
        else redraw();
      },
    });
    _viewerPanel.circular(true);
  }
  return _viewerPanel;
}

// What the viewer asks the reveal for: its own layers, no question mode, no rotation —
// a constellation you looked up sits north-up, not at the angle a question happened
// to spin it to — and the learner's chosen star-figure set.
function viewerIntent() {
  return {
    layers: {
      photo: viewerLayers.photo, diagram: viewerLayers.diagram,
      art: viewerLayers.art, boundary: viewerLayers.boundary,
    },
    mode: 'diagram',
    rotation: 0,
    source: diagramSource,
  };
}

// The enter action of the view route. The screen is already active by the time this
// runs (js/screens.js applies it first), which is what lets the panel measure itself.
function showViewer(con) {
  _viewerCon = con;
  document.getElementById('view-breadcrumb-stage').textContent = con.name;
  document.getElementById('view-picker-input').value = con.name;
  document.getElementById('view-caption').innerHTML = conLabel(con);
  const panel = viewerPanel();
  panel.resize();
  panel.canvas.style.display = 'block';
  panel.showReveal(con, viewerIntent());
}

// Redraw what the viewer is showing, if it is showing anything — the Figures setting
// changing under it, for instance.
function redrawViewer() {
  if (_viewerCon && _viewerPanel) _viewerPanel.redraw(viewerIntent(), _viewerCon);
}

function initViewer() {
  const go = () => {
    const val = document.getElementById('view-picker-input').value.trim();
    const con = C.find(c => c.name.toLowerCase() === val.toLowerCase());
    if (con) navigate('view/' + con.abbr);
  };
  document.getElementById('view-picker-go').addEventListener('click', go);
  document.getElementById('view-picker-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') go();
  });
}
