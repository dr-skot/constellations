// ═══════════════════════════════════════════════════════════
// DIAGRAM SOURCES — alternate constellation stick-figures
// ═══════════════════════════════════════════════════════════
//
// One registry for the four star-figure sets, plus the pure accessor the draw
// paths use. IAU is the master catalog C; Rey/Stellarium/Ford are alternate
// line-figures keyed by abbr, drawn in place of C's figure. They share the
// catalog schema; only `stars` and `lines` differ.
//
// The alternate figure sets are ~139 KB and are NOT required to load this file.
// A host that only ever draws IAU — find-help.html — omits them and pays 2 KB
// instead, drawing C's own figure throughout. A host that lets the learner pick
// a figure style — index.html — loads all three. Hence the lazy build below and
// the typeof guard: the lookup for a source is built on first use, and a source
// whose data this page did not load falls back to IAU rather than throwing.

const DIAGRAM_SOURCES = [
  { key: 'iau',        label: 'IAU' },
  { key: 'rey',        label: 'Rey' },
  { key: 'stellarium', label: 'Stellarium' },
  { key: 'ford',       label: 'Ford' },
];

// Where each non-IAU source's figures come from. IAU is absent: it is the
// identity, drawn straight from C.
const _diagData = {
  rey:        () => (typeof REY  !== 'undefined' ? REY  : null),
  stellarium: () => (typeof SC   !== 'undefined' ? SC   : null),
  ford:       () => (typeof FORD !== 'undefined' ? FORD : null),
};

// abbr → figure, per non-IAU source. Built on first use, and cached.
const _diagByAbbr = {};

function _diagMap(sourceKey) {
  if (!(sourceKey in _diagData)) return null;   // 'iau' or any unknown key
  if (!(sourceKey in _diagByAbbr)) {
    const rows = _diagData[sourceKey]();        // null when this page omitted the data
    _diagByAbbr[sourceKey] = rows ? Object.fromEntries(rows.map(c => [c.abbr, c])) : null;
  }
  return _diagByAbbr[sourceKey];
}

// The figure to DRAW for `con` under `sourceKey`. Swaps only stars+lines; callers
// keep `con` for framing, answers, bounds, art, exposure. Falls back to `con`
// when the source lacks this constellation, the key is unknown, or this page did
// not load that source's data.
function diagramFor(con, sourceKey) {
  const map = _diagMap(sourceKey);
  if (!map) return con;
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
