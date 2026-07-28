// ═══════════════════════════════════════════════════════════
// DIAGRAM SOURCES — alternate constellation stick-figures
// ═══════════════════════════════════════════════════════════
//
// One registry for the four star-figure sets, plus the pure accessor the draw
// paths use. IAU is the master catalog C; Rey/Stellarium/Ford are alternate
// line-figures keyed by abbr, drawn in place of C's figure. They share the
// catalog schema; only `stars` and `lines` differ.
//
// Loaded after data.js / stellarium-data.js / ford-data.js / rey-data.js so the
// source arrays exist — no defensive typeof needed.

const DIAGRAM_SOURCES = [
  { key: 'iau',        label: 'IAU' },
  { key: 'rey',        label: 'Rey' },
  { key: 'stellarium', label: 'Stellarium' },
  { key: 'ford',       label: 'Ford' },
];

// abbr → figure, per non-IAU source. IAU is the sentinel null (use con as-is).
const _diagByAbbr = {
  iau:        null,
  rey:        Object.fromEntries(REY.map(c => [c.abbr, c])),
  stellarium: Object.fromEntries(SC.map(c => [c.abbr, c])),
  ford:       Object.fromEntries(FORD.map(c => [c.abbr, c])),
};

// The figure to DRAW for `con` under `sourceKey`. Swaps only stars+lines; callers
// keep `con` for framing, answers, bounds, art, exposure. Falls back to `con`
// when the source lacks this constellation or the key is unknown.
function diagramFor(con, sourceKey) {
  const map = _diagByAbbr[sourceKey];
  if (!map) return con;                 // 'iau' or any unknown key
  return map[con.abbr] || con;          // fall back when a source omits this con
}

// ── Selected source (app-global, persisted; read by explorer + quiz draw) ──
let diagramSource = 'iau';

function loadDiagramSource() {
  const v = localStorage.getItem('ex-diagramSource');
  if (v && DIAGRAM_SOURCES.some(s => s.key === v)) diagramSource = v;
  return diagramSource;
}

function setDiagramSource(key) {
  if (!DIAGRAM_SOURCES.some(s => s.key === key)) return;
  diagramSource = key;
  localStorage.setItem('ex-diagramSource', key);
}
