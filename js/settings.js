// ═══════════════════════════════════════════════════════════
// SETTINGS SCREEN — data-driven registry of setting cards
// ═══════════════════════════════════════════════════════════
//
// One card per SETTINGS entry, rendered into #settings-list. Each descriptor:
//   { id, title, description?, render(mountEl) }
// The card template owns the title + optional description; render() owns the
// control and any live example. Only "Figures" exists today — add a setting by
// pushing another descriptor (extensibility shape from the settings-page design).
//
// Loaded after diagram-sources.js / render.js / components.js so diagramFor,
// renderCanvas, and createToggleGroup exist when render() runs.

const UMA = () => C.find(c => c.abbr === 'UMa');   // the fixed example constellation

// Per-source explanatory copy — one blurb per diagram source (kept in step with
// DIAGRAM_SOURCES; test/settings.js fails if a source lacks a blurb).
const FIGURE_BLURB = {
  iau:        'The standard textbook figure — the familiar lines on most star charts. The default.',
  rey:        "H.A. Rey's 1952 redrawing (yes, the Curious George author). Extra lines make each pattern actually resemble its namesake — the Big Dipper fills out into a real bear. Best for learning the sky.",
  stellarium: 'The clean lines from the Stellarium planetarium — connect the bright stars, no frills.',
  ford:       "Dominic Ford's minimalist set: only the brightest stars (4th magnitude and up). The sparsest, most uncluttered view.",
};

let _settingsGroup = null;    // the Figures toggle group (synced by applyDiagramSource)
let _settingsCanvas = null;   // the live Ursa Major preview
let _settingsBlurb = null;    // the per-source blurb under the preview

const figuresSetting = {
  id: 'figures',
  title: 'Figures',
  description: "Different traditions for connecting a constellation's stars. Applies everywhere figures are drawn, including the quiz.",
  render(mountEl) {
    const pickHost = document.createElement('div');
    pickHost.className = 'toggle-group';
    _settingsGroup = createToggleGroup(pickHost, {
      exclusive: true,   // no caption — the card's <h2> title already labels this "Figures"
      buttons: DIAGRAM_SOURCES.map(s => ({ label: s.label, value: s.key, on: s.key === diagramSource })),
      onChange(value, on) { if (on) applyDiagramSource(value); },
    });

    _settingsCanvas = document.createElement('canvas');
    _settingsCanvas.className = 'setting-figure';

    _settingsBlurb = document.createElement('p');
    _settingsBlurb.className = 'setting-blurb';

    mountEl.append(pickHost, _settingsCanvas, _settingsBlurb);
    redrawSettingsFigure();
  },
};

const SETTINGS = [figuresSetting];

// Draw the live Ursa Major preview for the selected source and sync the blurb.
// Reads the app-global diagramSource via renderCanvas — no source-explicit draw
// path is needed, because the preview always shows the currently-selected figure.
function redrawSettingsFigure() {
  if (!_settingsCanvas) return;
  const w = _settingsCanvas.clientWidth;
  if (!w) return;                                    // hidden (display:none) — redrawn on route enter
  const dpr = displayScale();
  sizeCanvas(_settingsCanvas, w * dpr, _settingsCanvas.clientHeight * dpr);
  renderCanvas(_settingsCanvas, UMA(), 'diagram');
  _settingsBlurb.textContent = FIGURE_BLURB[diagramSource] || '';
}

// Build the settings screen once — loop the registry into cards.
function initSettings() {
  loadDiagramSource();
  const list = document.getElementById('settings-list');
  if (!list) return;
  for (const s of SETTINGS) {
    const card = document.createElement('section');
    card.className = 'setting-card';

    const h = document.createElement('h2');
    h.textContent = s.title;
    card.appendChild(h);

    if (s.description) {
      const d = document.createElement('p');
      d.className = 'setting-desc';
      d.textContent = s.description;
      card.appendChild(d);
    }

    const mount = document.createElement('div');
    card.appendChild(mount);
    list.appendChild(card);
    s.render(mount);
  }
}

// Called when the settings screen becomes visible, so the preview (which needs a
// laid-out canvas to size itself) draws at the right dimensions.
function refreshSettings() { redrawSettingsFigure(); }
