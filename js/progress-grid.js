// Shared progress-grid renderer: the tier ladder, the tier-state logic, and the
// constellation-card builder. Loaded as a plain-script global (no build). Today the full
// progress page (progress.html) is the only caller; the in-app result screen (index.html)
// wires it in next (see #20/#21) so both surfaces draw the same cards. The `highlight`
// hook exists now so those callers have it. Depends on nothing but the DOM (only
// progressCard touches it).

const TIERS = [
  { key: 'identify/diagram', short: 'iD', label: 'Identify by diagram' },
  { key: 'find/diagram',     short: 'fD', label: 'Find by diagram' },
  { key: 'identify/stars',   short: 'iS', label: 'Identify by stars' },
  { key: 'find/stars',       short: 'fS', label: 'Find by stars' },
  { key: 'identify/photo',   short: 'iP', label: 'Identify by photo' },
  { key: 'find/photo',       short: 'fP', label: 'Find by photo' },
  { key: 'find/photo-nb',    short: 'nP', label: 'Find by photo (no bounds)' },
];

// Classify one constellation+tier against an explicit exposure record:
// 'passed' (correct>=1) | 'seen' (seen>=1) | 'unseen'.
function tierClass(exposure, abbr, key) {
  const t = exposure?.[abbr]?.[key];
  if (!t) return 'unseen';
  if (t.correct >= 1) return 'passed';
  if (t.seen >= 1) return 'seen';
  return 'unseen';
}

// The distinct constellations across a lesson's questions, deduped by abbr in
// first-encounter order — the set of cards a result/progress surface shows for a lesson.
function distinctCons(questions) {
  const seen = new Set();
  const out = [];
  for (const q of questions || []) {
    const con = q?.con;
    if (con && !seen.has(con.abbr)) { seen.add(con.abbr); out.push(con); }
  }
  return out;
}

// Build a .con-card element (name + 7 tier dots) for `con` against `exposure`.
// opts.highlight: a Set of "abbr/tierKey" strings; matching dots get `.just-passed`.
function progressCard(con, exposure, opts = {}) {
  const highlight = opts.highlight;
  const e = exposure?.[con.abbr];
  const unseen = (e?.['identify/diagram']?.seen || 0) === 0;

  const card = document.createElement('div');
  card.className = 'con-card' + (unseen ? ' unseen' : '');

  const dots = TIERS.map(t => {
    const cls = tierClass(exposure, con.abbr, t.key);
    const data = e?.[t.key];
    const tip = `${t.key}: seen ${data?.seen || 0}, correct ${data?.correct || 0}`;
    const pop = highlight && highlight.has(`${con.abbr}/${t.key}`) ? ' just-passed' : '';
    return `<div class="tier ${cls}${pop}" title="${tip}"></div>`;
  }).join('');

  card.innerHTML =
    `<div class="con-name" title="${con.name}">${con.name}</div>` +
    `<div class="tiers">${dots}</div>`;
  return card;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TIERS, tierClass, distinctCons, progressCard };
}
